import crypto from 'node:crypto';

const ENC_PREFIX = 'enc:v1:';
const EPHEMERAL_FALLBACK = crypto.randomBytes(32).toString('hex');

function getVaultKey(): Buffer {
  const configured = (process.env.DATA_ENCRYPTION_KEY || '').trim();
  if (configured && configured !== 'CHANGE_ME_TO_A_32_BYTE_HEX_OR_RANDOM_STRING') {
    return crypto.createHash('sha256').update(`vtk-vault:${configured}`).digest();
  }

  const sessionSecret = (process.env.SESSION_SECRET || '').trim();
  if (sessionSecret && sessionSecret !== 'CHANGE_ME_TO_A_LONG_RANDOM_SECRET') {
    return crypto.createHash('sha256').update(`vtk-vault-session:${sessionSecret}`).digest();
  }

  const tursoToken = (process.env.TURSO_AUTH_TOKEN || '').trim();
  if (tursoToken && tursoToken !== 'YOUR_TURSO_AUTH_TOKEN') {
    return crypto.createHash('sha256').update(`vtk-vault-turso:${tursoToken}`).digest();
  }

  return crypto.createHash('sha256').update(`vtk-vault-ephemeral:${EPHEMERAL_FALLBACK}`).digest();
}

export function encryptSecret(plaintext: string): string {
  if (!plaintext) return '';
  const key = getVaultKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${ENC_PREFIX}${iv.toString('base64url')}:${authTag.toString('base64url')}:${encrypted.toString('base64url')}`;
}

export function isEncryptedSecret(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(ENC_PREFIX);
}

export function decryptSecret(stored: string | null | undefined): string | null {
  if (!stored) return null;
  if (!stored.startsWith(ENC_PREFIX)) {
    // Legacy unencrypted value (e.g., pre-migration Base32 TOTP secret)
    return stored;
  }

  const rest = stored.slice(ENC_PREFIX.length);
  const parts = rest.split(':');
  if (parts.length !== 3) return null;

  try {
    const iv = Buffer.from(parts[0], 'base64url');
    const authTag = Buffer.from(parts[1], 'base64url');
    const ciphertext = Buffer.from(parts[2], 'base64url');
    if (iv.length !== 12 || authTag.length !== 16) return null;

    const key = getVaultKey();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
}
