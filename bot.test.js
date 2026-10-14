const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createBot, TRADING_DISABLED_MESSAGE } = require('./index');
const { CALLBACK_URL, loadConfig } = require('./src/config');
const {
  AUTHORIZATION_ENDPOINT,
  OAuthError,
  createOAuthService,
  sha256Base64Url,
} = require('./src/oauth');
const { createStore } = require('./src/store');
const {
  createHttpServer,
  createRateLimiter,
  verifyPublicRoutes,
} = require('./src/server');

const encryptionKey = Buffer.alloc(32, 5);

function makeStore() {
  const states = new Map();
  const accounts = new Map();
  return {
    createState(state) {
      states.set(state.stateHash, state);
    },
    consumeState(stateHash) {
      const state = states.get(stateHash);
      states.delete(stateHash);
      return state || null;
    },
    deleteExpiredStates(now) {
      for (const [key, state] of states) {
        if (state.expiresAt <= now) states.delete(key);
      }
    },
    hasAccount(userId) {
      return accounts.has(userId);
    },
    saveAccount(account) {
      accounts.set(account.telegramUserId, account);
    },
    getAccount(userId) {
      return accounts.get(userId) || null;
    },
    updateTokens(tokens) {
      accounts.set(tokens.telegramUserId, tokens);
    },
    removeAccount(userId) {
      return accounts.delete(userId);
    },
    accounts,
  };
}

test('OAuth configuration requires the exact public callback domain and a 32-byte key', () => {
  const env = {
    TELEGRAM_BOT_TOKEN: 'telegram-test-token',
    TELEGRAM_WEBHOOK_SECRET: 'webhook-test-secret',
    DERIV_CLIENT_ID: 'deriv-client-id',
    DERIV_OAUTH_SCOPES: 'read',
    TOKEN_ENCRYPTION_KEY: encryptionKey.toString('base64'),
    PUBLIC_BASE_URL: 'https://g-squad.buzz',
  };
  const config = loadConfig(env);
  assert.equal(config.callbackUrl, CALLBACK_URL);
  assert.throws(() => loadConfig({ ...env, PUBLIC_BASE_URL: 'https://example.com' }), /PUBLIC_BASE_URL/);
  assert.throws(
    () => loadConfig({ ...env, TOKEN_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') }),
    /32-byte/
  );
});

test('authorization URL uses Deriv OAuth, fresh state, and an S256 PKCE challenge', () => {
  const store = makeStore();
  const oauth = createOAuthService({ store, clientId: 'client', scopes: 'read trade' });

  const url = new URL(oauth.createAuthorizationUrl('telegram-user-1'));
  assert.equal(url.origin + url.pathname, AUTHORIZATION_ENDPOINT);
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('client_id'), 'client');
  assert.equal(url.searchParams.get('redirect_uri'), CALLBACK_URL);
  assert.equal(url.searchParams.get('scope'), 'read trade');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');

  const state = url.searchParams.get('state');
  const saved = store.consumeState(sha256Base64Url(state));
  assert.equal(saved.telegramUserId, 'telegram-user-1');
  assert.equal(
    url.searchParams.get('code_challenge'),
    sha256Base64Url(saved.verifier)
  );
});

test('callback consumes valid state once and stores tokens without returning them', async () => {
  const store = makeStore();
  let requested;
  const authorizedUsers = [];
  const oauth = createOAuthService({
    store,
    clientId: 'client',
    scopes: 'read',
    fetchImpl: async (url, options) => {
      requested = { url, options, body: new URLSearchParams(options.body) };
      return {
        ok: true,
        json: async () => ({
          access_token: 'access-secret',
          refresh_token: 'refresh-secret',
          expires_in: 3600,
        }),
      };
    },
    onAuthorized: async (userId) => authorizedUsers.push(userId),
  });

  const authorization = new URL(oauth.createAuthorizationUrl('telegram-user-2'));
  await oauth.completeAuthorization({
    state: authorization.searchParams.get('state'),
    code: 'one-time-code',
  });

  assert.equal(requested.url, 'https://auth.deriv.com/oauth2/token');
  assert.equal(requested.body.get('grant_type'), 'authorization_code');
  assert.equal(requested.body.get('code'), 'one-time-code');
  assert.equal(requested.body.get('redirect_uri'), CALLBACK_URL);
  assert.equal(requested.body.get('code_verifier').length, 43);
  assert.equal(store.getAccount('telegram-user-2').accessToken, 'access-secret');
  assert.deepEqual(authorizedUsers, ['telegram-user-2']);

  await assert.rejects(
    oauth.completeAuthorization({
      state: authorization.searchParams.get('state'),
      code: 'reused-code',
    }),
    (error) => error instanceof OAuthError && error.code === 'invalid_state'
  );
});

test('expired access tokens use the stored refresh token and rotate it when returned', async () => {
  const store = makeStore();
  store.saveAccount({
    telegramUserId: 'telegram-user-3',
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
    expiresAt: Date.now() - 1,
  });
  let refreshRequest;
  const oauth = createOAuthService({
    store,
    clientId: 'client',
    scopes: 'read',
    fetchImpl: async (url, options) => {
      refreshRequest = new URLSearchParams(options.body);
      return {
        ok: true,
        json: async () => ({
          access_token: 'new-access',
          refresh_token: 'new-refresh',
          expires_in: 3600,
        }),
      };
    },
  });

  assert.equal(await oauth.getValidAccessToken('telegram-user-3'), 'new-access');
  assert.equal(refreshRequest.get('grant_type'), 'refresh_token');
  assert.equal(store.getAccount('telegram-user-3').refreshToken, 'new-refresh');
});

test('an invalid refresh grant removes the expired account link', async () => {
  const store = makeStore();
  store.saveAccount({
    telegramUserId: 'telegram-user-5',
    accessToken: 'old-access',
    refreshToken: 'revoked-refresh',
    expiresAt: Date.now() - 1,
  });
  const oauth = createOAuthService({
    store,
    clientId: 'client',
    scopes: 'read',
    fetchImpl: async () => ({
      ok: false,
      json: async () => ({ error: 'invalid_grant' }),
    }),
  });

  await assert.rejects(
    oauth.getValidAccessToken('telegram-user-5'),
    (error) => error instanceof OAuthError && error.code === 'expired_refresh_token'
  );
  assert.equal(store.hasAccount('telegram-user-5'), false);
});

test('SQLite account tokens are encrypted at rest and can be removed', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'deriv-bot-test-'));
  const databasePath = path.join(directory, 'accounts.sqlite');
  const store = createStore(databasePath, encryptionKey);
  t.after(() => {
    store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  store.saveAccount({
    telegramUserId: 'telegram-user-4',
    accessToken: 'access-at-rest-secret',
    refreshToken: 'refresh-at-rest-secret',
    expiresAt: Date.now() + 3600_000,
  });
  assert.equal(store.getAccount('telegram-user-4').accessToken, 'access-at-rest-secret');
  assert.equal(store.hasAccount('telegram-user-4'), true);
  const databaseFile = fs.readFileSync(databasePath);
  assert.equal(databaseFile.includes(Buffer.from('access-at-rest-secret')), false);
  assert.equal(databaseFile.includes(Buffer.from('refresh-at-rest-secret')), false);
  assert.equal(store.removeAccount('telegram-user-4'), true);
  assert.equal(store.hasAccount('telegram-user-4'), false);
});

test('backend rejects plain HTTP and does not reflect invalid OAuth callback parameters', async (t) => {
  const config = {
    publicBaseUrl: 'https://g-squad.buzz',
    trustProxy: true,
    telegramWebhookSecret: 'webhook-secret',
  };
  const oauth = {
    async completeAuthorization() {
      throw new OAuthError('invalid_state');
    },
  };
  const bot = { async handleUpdate() {} };
  const server = createHttpServer({ config, oauth, bot });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const insecure = await fetch(`${baseUrl}/oauth/callback`);
  assert.equal(insecure.status, 426);

  const invalid = await fetch(`${baseUrl}/oauth/callback?state=attacker-state&code=secret-code`, {
    headers: { 'x-forwarded-proto': 'https' },
    redirect: 'manual',
  });
  assert.equal(invalid.status, 303);
  assert.equal(invalid.headers.get('location'), '/oauth/complete');
  assert.equal(invalid.headers.get('cache-control'), 'no-store');
  assert.equal(invalid.headers.get('referrer-policy'), 'no-referrer');

  const completion = await fetch(`${baseUrl}/oauth/complete`, {
    headers: { 'x-forwarded-proto': 'https' },
  });
  assert.equal(completion.status, 200);
  assert.match(await completion.text(), /Check Telegram/);
});

test('rate limiter blocks requests after the configured limit', () => {
  const allow = createRateLimiter({ limit: 2, windowMs: 1000 });
  assert.equal(allow('user', 1000), true);
  assert.equal(allow('user', 1100), true);
  assert.equal(allow('user', 1200), false);
  assert.equal(allow('user', 2000), true);
});

test('startup accepts only public routes reaching the OAuth and webhook handlers', async () => {
  const responses = [
    new Response('', {
      status: 303,
      headers: {
        location: '/oauth/complete',
        'cache-control': 'no-store',
      },
    }),
    new Response('Forbidden.', { status: 403 }),
  ];
  await verifyPublicRoutes('https://g-squad.buzz', async () => responses.shift());

  await assert.rejects(
    verifyPublicRoutes('https://g-squad.buzz', async () => new Response('It works!', { status: 200 })),
    /reverse proxy/
  );
});

test('bot exposes only account connection and status commands', () => {
  const bot = createBot({
    token: 'test-token',
    oauth: { createAuthorizationUrl: () => 'https://auth.deriv.com/' },
    store: { hasAccount: () => false, removeAccount: () => false },
  });
  assert.equal(typeof bot.command, 'function');
  assert.match(TRADING_DISABLED_MESSAGE, /Trading is disabled/);
});
