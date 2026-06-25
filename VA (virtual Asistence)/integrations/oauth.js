'use strict';

const crypto = require('crypto');
const { google } = require('googleapis');

const GOOGLE_GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
];

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;
const TOKEN_ENCRYPTION_KEY = process.env.TOKEN_ENCRYPTION_KEY;
const TOKEN_ENCRYPTION_KEY_ID = process.env.TOKEN_ENCRYPTION_KEY_ID || 'env:v1';

function requireGoogleConfig() {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
    throw new Error('GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI are required.');
  }
}

function requireClientId(session) {
  const clientId = session?.client_id;

  if (!clientId) {
    throw new Error('A verified session client_id is required.');
  }

  return clientId;
}

function getOAuthClient() {
  requireGoogleConfig();

  return new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI
  );
}

function getEncryptionKey() {
  if (!TOKEN_ENCRYPTION_KEY) {
    throw new Error('TOKEN_ENCRYPTION_KEY is required for OAuth token encryption.');
  }

  const key = Buffer.from(TOKEN_ENCRYPTION_KEY, 'base64');

  if (key.length !== 32) {
    throw new Error('TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
  }

  return key;
}

function encryptSecret(secret) {
  if (!secret) {
    throw new Error('Cannot encrypt an empty OAuth token.');
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(secret, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    'aes-256-gcm',
    iv.toString('base64'),
    tag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
}

function decryptSecret(encryptedSecret) {
  const [algorithm, iv, tag, ciphertext] = String(encryptedSecret).split(':');

  if (algorithm !== 'aes-256-gcm' || !iv || !tag || !ciphertext) {
    throw new Error('Encrypted OAuth token has an unsupported format.');
  }

  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    getEncryptionKey(),
    Buffer.from(iv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(tag, 'base64'));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

async function withTenantSession(db, clientId, callback) {
  await db.query('BEGIN');

  try {
    await db.query('SELECT set_config($1, $2, true)', [
      'app.current_client_id',
      clientId,
    ]);
    const result = await callback();
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}

function generateGoogleAuthUrl({ session, state }) {
  requireClientId(session);

  if (!state) {
    throw new Error('A secure OAuth state value is required.');
  }

  return getOAuthClient().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: GOOGLE_GMAIL_SCOPES,
    state,
  });
}

async function handleGoogleOAuthCallback({ db, session, code, state, expectedState }) {
  const clientId = requireClientId(session);

  if (!db) {
    throw new Error('A database client is required.');
  }

  if (!code) {
    throw new Error('Google OAuth callback code is required.');
  }

  if (!state || state !== expectedState) {
    throw new Error('Google OAuth state validation failed.');
  }

  const oauthClient = getOAuthClient();
  const { tokens } = await oauthClient.getToken(code);

  if (!tokens.access_token || !tokens.refresh_token) {
    throw new Error('Google OAuth did not return both access and refresh tokens.');
  }

  const encryptedAccessToken = encryptSecret(tokens.access_token);
  const encryptedRefreshToken = encryptSecret(tokens.refresh_token);
  const scopes = String(tokens.scope || '').split(' ').filter(Boolean);

  await withTenantSession(db, clientId, async () => {
    await db.query(
      `
        INSERT INTO app.integration_credentials (
          client_id,
          provider,
          encrypted_access_token,
          encrypted_refresh_token,
          token_encryption_key_id,
          token_expires_at,
          scopes,
          updated_at
        )
        VALUES ($1, 'google', $2, $3, $4, to_timestamp($5 / 1000.0), $6, now())
        ON CONFLICT (client_id, provider)
        DO UPDATE SET
          encrypted_access_token = EXCLUDED.encrypted_access_token,
          encrypted_refresh_token = EXCLUDED.encrypted_refresh_token,
          token_encryption_key_id = EXCLUDED.token_encryption_key_id,
          token_expires_at = EXCLUDED.token_expires_at,
          scopes = EXCLUDED.scopes,
          updated_at = now()
      `,
      [
        clientId,
        encryptedAccessToken,
        encryptedRefreshToken,
        TOKEN_ENCRYPTION_KEY_ID,
        tokens.expiry_date || null,
        scopes,
      ]
    );
  });

  return {
    provider: 'google',
    client_id: clientId,
    scopes,
    token_expires_at: tokens.expiry_date
      ? new Date(tokens.expiry_date).toISOString()
      : null,
  };
}

module.exports = {
  GOOGLE_GMAIL_SCOPES,
  decryptSecret,
  encryptSecret,
  generateGoogleAuthUrl,
  handleGoogleOAuthCallback,
  withTenantSession,
};
