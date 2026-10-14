const CALLBACK_URL = 'https://g-squad.buzz/oauth/callback';
const PUBLIC_BASE_URL = 'https://g-squad.buzz';

function required(env, name) {
  const value = env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable ${name}.`);
  }
  return value.trim();
}

function loadConfig(env = process.env) {
  const publicBaseUrl = required(env, 'PUBLIC_BASE_URL');
  if (publicBaseUrl !== PUBLIC_BASE_URL) {
    throw new Error(`PUBLIC_BASE_URL must be ${PUBLIC_BASE_URL}.`);
  }

  const encodedKey = required(env, 'TOKEN_ENCRYPTION_KEY');
  const encryptionKey = Buffer.from(encodedKey, 'base64');
  if (
    !/^[A-Za-z0-9+/]+={0,2}$/.test(encodedKey) ||
    encryptionKey.length !== 32 ||
    encryptionKey.toString('base64') !== encodedKey
  ) {
    throw new Error('TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
  }

  const telegramWebhookSecret = required(env, 'TELEGRAM_WEBHOOK_SECRET');
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(telegramWebhookSecret)) {
    throw new Error('TELEGRAM_WEBHOOK_SECRET must use only letters, digits, underscores, and hyphens.');
  }

  const scopes = required(env, 'DERIV_OAUTH_SCOPES').split(/\s+/).filter(Boolean);
  if (scopes.length === 0) {
    throw new Error('DERIV_OAUTH_SCOPES must contain the scopes configured for the Deriv OAuth app.');
  }

  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }

  return {
    telegramBotToken: required(env, 'TELEGRAM_BOT_TOKEN'),
    telegramWebhookSecret,
    derivClientId: required(env, 'DERIV_CLIENT_ID'),
    derivOAuthScopes: scopes.join(' '),
    encryptionKey,
    databasePath: env.DATABASE_PATH || './data/telegram-deriv.sqlite',
    publicBaseUrl,
    callbackUrl: CALLBACK_URL,
    port,
    bindHost: env.BIND_HOST || '127.0.0.1',
    trustProxy: env.TRUST_PROXY === 'true',
  };
}

module.exports = { CALLBACK_URL, PUBLIC_BASE_URL, loadConfig };
