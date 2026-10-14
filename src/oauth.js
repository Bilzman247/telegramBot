const {
  createHash,
  randomBytes,
} = require('node:crypto');
const { CALLBACK_URL } = require('./config');

const AUTHORIZATION_ENDPOINT = 'https://auth.deriv.com/oauth2/auth';
const TOKEN_ENDPOINT = 'https://auth.deriv.com/oauth2/token';
const STATE_TTL_MS = 10 * 60 * 1000;
const TOKEN_TIMEOUT_MS = 10 * 1000;

class OAuthError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function sha256Base64Url(value) {
  return createHash('sha256').update(value).digest('base64url');
}

function createOAuthService({
  store,
  clientId,
  scopes,
  callbackUrl = CALLBACK_URL,
  fetchImpl = fetch,
  onAuthorized = async () => {},
  onAuthorizationError = async () => {},
}) {
  function createAuthorizationUrl(telegramUserId) {
    const state = randomBytes(32).toString('base64url');
    const verifier = randomBytes(32).toString('base64url');
    const expiresAt = Date.now() + STATE_TTL_MS;

    store.deleteExpiredStates(Date.now());
    store.createState({
      stateHash: sha256Base64Url(state),
      telegramUserId,
      verifier,
      expiresAt,
    });

    const url = new URL(AUTHORIZATION_ENDPOINT);
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: callbackUrl,
      scope: scopes,
      state,
      code_challenge: sha256Base64Url(verifier),
      code_challenge_method: 'S256',
    }).toString();
    return url.toString();
  }

  function takeState(state) {
    if (typeof state !== 'string' || state.length < 32 || state.length > 128) return null;
    const stored = store.consumeState(sha256Base64Url(state));
    return stored || null;
  }

  async function exchange(form) {
    let response;
    try {
      response = await fetchImpl(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(form),
        signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
        redirect: 'error',
      });
    } catch (error) {
      throw new OAuthError('exchange_failed');
    }

    let body;
    try {
      body = await response.json();
    } catch (error) {
      throw new OAuthError('exchange_failed');
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new OAuthError('exchange_failed');
    }

    if (!response.ok) {
      if (body.error === 'invalid_grant') {
        throw new OAuthError(form.grant_type === 'refresh_token' ? 'expired_refresh_token' : 'expired_code');
      }
      throw new OAuthError('exchange_failed');
    }

    if (
      typeof body.access_token !== 'string' ||
      !body.access_token ||
      !Number.isFinite(Number(body.expires_in)) ||
      Number(body.expires_in) <= 0
    ) {
      throw new OAuthError('exchange_failed');
    }
    return body;
  }

  async function completeAuthorization({ state, code, providerError }) {
    const stored = takeState(state);
    if (!stored) throw new OAuthError('invalid_state');

    if (stored.expiresAt <= Date.now()) {
      await onAuthorizationError(stored.telegramUserId, 'expired_code');
      throw new OAuthError('expired_state');
    }

    if (providerError) {
      await onAuthorizationError(stored.telegramUserId, 'denied');
      throw new OAuthError('denied');
    }

    if (typeof code !== 'string' || !code || code.length > 4096) {
      await onAuthorizationError(stored.telegramUserId, 'exchange_failed');
      throw new OAuthError('exchange_failed');
    }

    try {
      const tokens = await exchange({
        grant_type: 'authorization_code',
        client_id: clientId,
        code,
        redirect_uri: callbackUrl,
        code_verifier: stored.verifier,
      });
      const now = Date.now();
      store.saveAccount({
        telegramUserId: stored.telegramUserId,
        accessToken: tokens.access_token,
        refreshToken: typeof tokens.refresh_token === 'string' ? tokens.refresh_token : null,
        expiresAt: now + Number(tokens.expires_in) * 1000,
        now,
      });
      await onAuthorized(stored.telegramUserId);
    } catch (error) {
      const reason = error instanceof OAuthError && error.code === 'expired_code'
        ? 'expired_code'
        : 'exchange_failed';
      await onAuthorizationError(stored.telegramUserId, reason);
      if (error instanceof OAuthError) throw error;
      throw new OAuthError('exchange_failed');
    }
  }

  async function getValidAccessToken(telegramUserId) {
    const account = store.getAccount(telegramUserId);
    if (!account) throw new OAuthError('not_connected');
    if (account.expiresAt > Date.now() + 60_000) return account.accessToken;
    if (!account.refreshToken) throw new OAuthError('expired_refresh_token');

    try {
      const tokens = await exchange({
        grant_type: 'refresh_token',
        client_id: clientId,
        refresh_token: account.refreshToken,
      });
      store.updateTokens({
        telegramUserId,
        accessToken: tokens.access_token,
        refreshToken: typeof tokens.refresh_token === 'string'
          ? tokens.refresh_token
          : account.refreshToken,
        expiresAt: Date.now() + Number(tokens.expires_in) * 1000,
      });
      return tokens.access_token;
    } catch (error) {
      if (error instanceof OAuthError && error.code === 'expired_refresh_token') {
        store.removeAccount(telegramUserId);
        throw error;
      }
      throw error;
    }
  }

  return { createAuthorizationUrl, completeAuthorization, getValidAccessToken };
}

module.exports = {
  AUTHORIZATION_ENDPOINT,
  TOKEN_ENDPOINT,
  OAuthError,
  createOAuthService,
  sha256Base64Url,
};
