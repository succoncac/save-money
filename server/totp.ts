import crypto from 'node:crypto';
import QRCode from 'qrcode';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

export function base32Decode(input: string): Buffer {
  const cleaned = input.toUpperCase().replace(/[\s=-]+/g, '');
  if (!cleaned) return Buffer.alloc(0);

  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (let i = 0; i < cleaned.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(cleaned[i]);
    if (idx === -1) {
      throw new Error('Mã khóa bí mật Base32 không hợp lệ.');
    }
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

export function generateBase32Secret(byteLength = 20): string {
  return base32Encode(crypto.randomBytes(byteLength));
}

export function formatSecretForDisplay(secret: string): string {
  return secret.replace(/(.{4})/g, '$1 ').trim();
}

export function generateTotpCode(
  secretBase32: string,
  timestampMs = Date.now(),
  stepSeconds = 30,
  digits = 6,
): string {
  const key = base32Decode(secretBase32);
  if (key.length === 0) {
    throw new Error('Secret Base32 trống.');
  }
  const counter = Math.floor(timestampMs / 1000 / stepSeconds);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));

  const hmac = crypto.createHmac('sha1', key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  const otp = binary % 10 ** digits;
  return String(otp).padStart(digits, '0');
}

export function verifyTotpCode(
  secretBase32: string,
  inputCode: string,
  timestampMs = Date.now(),
  window = 1,
  stepSeconds = 30,
): boolean {
  const normalized = inputCode.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(normalized)) {
    return false;
  }

  const inputBuf = Buffer.from(normalized, 'utf8');
  let matched = false;

  for (let delta = -window; delta <= window; delta++) {
    const candidate = generateTotpCode(
      secretBase32,
      timestampMs + delta * stepSeconds * 1000,
      stepSeconds,
      6,
    );
    const candidateBuf = Buffer.from(candidate, 'utf8');
    if (
      candidateBuf.length === inputBuf.length &&
      crypto.timingSafeEqual(candidateBuf, inputBuf)
    ) {
      matched = true;
    }
  }

  return matched;
}

export function buildOtpAuthUri(params: {
  issuer: string;
  accountName: string;
  secret: string;
}): string {
  const issuer = params.issuer.trim();
  const account = params.accountName.trim();
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const qs = new URLSearchParams({
    secret: params.secret,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${label}?${qs.toString()}`;
}

export async function generateQrDataUrl(otpauthUri: string): Promise<string> {
  return QRCode.toDataURL(otpauthUri, {
    width: 240,
    margin: 2,
    color: {
      dark: '#0f172a',
      light: '#ffffff',
    },
  });
}
