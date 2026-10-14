const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} = require('node:crypto');

function encrypt(value, key, purpose) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(purpose));
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}

function decrypt(value, key, purpose) {
  const packed = Buffer.from(value, 'base64');
  if (packed.length < 29) {
    throw new Error('Encrypted value is malformed.');
  }
  const decipher = createDecipheriv('aes-256-gcm', key, packed.subarray(0, 12));
  decipher.setAAD(Buffer.from(purpose));
  decipher.setAuthTag(packed.subarray(12, 28));
  return Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString('utf8');
}

function createStore(databasePath, encryptionKey) {
  fs.mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(databasePath);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA secure_delete = ON;
    CREATE TABLE IF NOT EXISTS oauth_states (
      state_hash TEXT PRIMARY KEY,
      telegram_user_id TEXT NOT NULL,
      encrypted_verifier TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS deriv_accounts (
      telegram_user_id TEXT PRIMARY KEY,
      encrypted_access_token TEXT NOT NULL,
      encrypted_refresh_token TEXT,
      expires_at INTEGER NOT NULL,
      permissions_accepted_at INTEGER NOT NULL,
      linked_at INTEGER NOT NULL
    );
  `);
  fs.chmodSync(databasePath, 0o600);

  const saveState = db.prepare(`
    INSERT INTO oauth_states (state_hash, telegram_user_id, encrypted_verifier, expires_at)
    VALUES (?, ?, ?, ?)
  `);
  const consumeState = db.prepare(`
    DELETE FROM oauth_states WHERE state_hash = ? RETURNING telegram_user_id, encrypted_verifier, expires_at
  `);
  const deleteExpiredStates = db.prepare('DELETE FROM oauth_states WHERE expires_at <= ?');
  const findAccount = db.prepare('SELECT * FROM deriv_accounts WHERE telegram_user_id = ?');
  const saveAccount = db.prepare(`
    INSERT INTO deriv_accounts (
      telegram_user_id, encrypted_access_token, encrypted_refresh_token,
      expires_at, permissions_accepted_at, linked_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(telegram_user_id) DO UPDATE SET
      encrypted_access_token = excluded.encrypted_access_token,
      encrypted_refresh_token = excluded.encrypted_refresh_token,
      expires_at = excluded.expires_at,
      permissions_accepted_at = excluded.permissions_accepted_at,
      linked_at = excluded.linked_at
  `);
  const removeAccount = db.prepare('DELETE FROM deriv_accounts WHERE telegram_user_id = ?');
  const updateTokens = db.prepare(`
    UPDATE deriv_accounts
    SET encrypted_access_token = ?, encrypted_refresh_token = ?, expires_at = ?
    WHERE telegram_user_id = ?
  `);

  return {
    createState({ stateHash, telegramUserId, verifier, expiresAt }) {
      saveState.run(
        stateHash,
        telegramUserId,
        encrypt(verifier, encryptionKey, 'oauth-pkce-verifier'),
        expiresAt
      );
    },
    consumeState(stateHash) {
      const row = consumeState.get(stateHash);
      if (!row) return null;
      return {
        telegramUserId: row.telegram_user_id,
        verifier: decrypt(row.encrypted_verifier, encryptionKey, 'oauth-pkce-verifier'),
        expiresAt: row.expires_at,
      };
    },
    deleteExpiredStates(now) {
      deleteExpiredStates.run(now);
    },
    hasAccount(telegramUserId) {
      return Boolean(findAccount.get(telegramUserId));
    },
    getAccount(telegramUserId) {
      const row = findAccount.get(telegramUserId);
      if (!row) return null;
      return {
        accessToken: decrypt(row.encrypted_access_token, encryptionKey, 'deriv-access-token'),
        refreshToken: row.encrypted_refresh_token
          ? decrypt(row.encrypted_refresh_token, encryptionKey, 'deriv-refresh-token')
          : null,
        expiresAt: row.expires_at,
      };
    },
    saveAccount({ telegramUserId, accessToken, refreshToken, expiresAt, now = Date.now() }) {
      saveAccount.run(
        telegramUserId,
        encrypt(accessToken, encryptionKey, 'deriv-access-token'),
        refreshToken ? encrypt(refreshToken, encryptionKey, 'deriv-refresh-token') : null,
        expiresAt,
        now,
        now
      );
    },
    updateTokens({ telegramUserId, accessToken, refreshToken, expiresAt }) {
      updateTokens.run(
        encrypt(accessToken, encryptionKey, 'deriv-access-token'),
        refreshToken ? encrypt(refreshToken, encryptionKey, 'deriv-refresh-token') : null,
        expiresAt,
        telegramUserId
      );
    },
    removeAccount(telegramUserId) {
      return removeAccount.run(telegramUserId).changes > 0;
    },
    close() {
      db.close();
    },
  };
}

module.exports = { createStore, encrypt, decrypt };
