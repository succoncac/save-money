import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { dbQuery } from './db';
import type { AuthUser, UserRole } from '../src/types';

export const SESSION_COOKIE_NAME = 'vtk_session';
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

// Read SESSION_SECRET from env, with an in-memory crypto.randomBytes fallback if unset
const FALLBACK_SESSION_SECRET = crypto.randomBytes(32).toString('hex');

function getSessionSecret(): string {
  const configured = (process.env.SESSION_SECRET || '').trim();
  if (configured && configured !== 'CHANGE_ME_TO_A_LONG_RANDOM_SECRET') {
    return configured;
  }
  return FALLBACK_SESSION_SECRET;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
  return `${salt}:${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  if (!salt || !keyHex) return false;
  const expected = Buffer.from(keyHex, 'hex');
  const derived = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
  if (expected.length !== derived.length) return false;
  return crypto.timingSafeEqual(expected, derived);
}

interface SessionPayload {
  uid: string;
  sv?: number;
  iat: number;
  exp: number;
}

export function signSessionToken(userId: string, sessionVersion = 1): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    uid: userId,
    sv: Math.max(1, Math.trunc(sessionVersion)),
    iat: nowSec,
    exp: nowSec + SESSION_TTL_SECONDS,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(payloadB64)
    .digest('base64url');
  return `${payloadB64}.${sig}`;
}

export function verifySessionToken(token: string | undefined): SessionPayload | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;
  if (!payloadB64 || !sigB64) return null;

  const expectedSig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(payloadB64)
    .digest('base64url');

  const sigBuf = Buffer.from(sigB64);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as SessionPayload;
    if (!parsed.uid || typeof parsed.exp !== 'number') return null;
    if (Math.floor(Date.now() / 1000) > parsed.exp) return null;
    return parsed;
  } catch {
    return null;
  }
}

interface TwoFactorTokenPayload {
  uid: string;
  purpose: '2fa_login';
  iat: number;
  exp: number;
}

const TWO_FACTOR_TOKEN_TTL_SECONDS = 5 * 60; // 5 minutes

export function signTwoFactorToken(userId: string): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const payload: TwoFactorTokenPayload = {
    uid: userId,
    purpose: '2fa_login',
    iat: nowSec,
    exp: nowSec + TWO_FACTOR_TOKEN_TTL_SECONDS,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(`2fa:${payloadB64}`)
    .digest('base64url');
  return `${payloadB64}.${sig}`;
}

export function verifyTwoFactorToken(token: string | undefined): string | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;
  if (!payloadB64 || !sigB64) return null;

  const expectedSig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(`2fa:${payloadB64}`)
    .digest('base64url');

  const sigBuf = Buffer.from(sigB64);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as TwoFactorTokenPayload;
    if (parsed.purpose !== '2fa_login' || !parsed.uid || typeof parsed.exp !== 'number') {
      return null;
    }
    if (Math.floor(Date.now() / 1000) > parsed.exp) return null;
    return parsed.uid;
  } catch {
    return null;
  }
}

export function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie;
  if (!header) return {};
  const map: Record<string, string> = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    try {
      map[k] = decodeURIComponent(v);
    } catch {
      map[k] = v;
    }
  }
  return map;
}

function isHttpsRequest(req: Request): boolean {
  const proto = req.headers['x-forwarded-proto'];
  if (typeof proto === 'string' && proto.split(',')[0].trim() === 'https') {
    return true;
  }
  if (req.secure) return true;
  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin.startsWith('https://')) {
    return true;
  }
  return false;
}

export function setSessionCookie(req: Request, res: Response, token: string): void {
  const isHttps = isHttpsRequest(req);
  const attrs = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    `Max-Age=${SESSION_TTL_SECONDS}`,
  ];
  if (isHttps) {
    attrs.push('SameSite=None', 'Secure', 'Partitioned');
  } else {
    attrs.push('SameSite=Lax');
  }
  res.setHeader('Set-Cookie', attrs.join('; '));
}

export function clearSessionCookie(req: Request, res: Response): void {
  const isHttps = isHttpsRequest(req);
  const attrs = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'Max-Age=0',
  ];
  if (isHttps) {
    attrs.push('SameSite=None', 'Secure', 'Partitioned');
  } else {
    attrs.push('SameSite=Lax');
  }
  res.setHeader('Set-Cookie', attrs.join('; '));
}

export interface DbUserRow extends Record<string, unknown> {
  id: string;
  username: string;
  password_hash: string;
  password_encrypted?: string;
  display_name: string;
  role: string;
  is_root_admin: number;
  is_locked: number;
  must_change_password: number;
  can_use_camera: number;
  can_use_chat: number;
  two_factor_enabled: number;
  two_factor_secret: string;
  two_factor_pending_secret: string;
  session_version?: number;
  created_at: string;
  updated_at: string;
}

export function mapDbUserToAuthUser(row: DbUserRow): AuthUser {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: (row.role === 'admin' ? 'admin' : 'user') as UserRole,
    isRootAdmin: Boolean(row.is_root_admin),
    isLocked: Boolean(row.is_locked),
    mustChangePassword: Boolean(row.must_change_password),
    canUseCamera: Boolean(row.can_use_camera),
    canUseChat: Boolean(row.can_use_chat),
    twoFactorEnabled: Boolean(row.two_factor_enabled),
    createdAt: row.created_at,
  };
}

export async function getUserById(userId: string): Promise<DbUserRow | null> {
  const rows = await dbQuery<DbUserRow>('SELECT * FROM app_users WHERE id = ? LIMIT 1', [userId]);
  return rows[0] ?? null;
}

export interface AuthenticatedRequest extends Request {
  authUser?: AuthUser;
}

export function verifyMutationOrigin(req: Request, res: Response, next: NextFunction): void {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    next();
    return;
  }

  const origin = req.headers.origin;
  const host = (req.headers['x-forwarded-host'] as string | undefined) || req.headers.host;
  if (origin && host) {
    try {
      const originHost = new URL(origin).host;
      if (originHost !== host && req.headers['x-requested-with'] !== 'XMLHttpRequest') {
        res.status(403).json({ error: 'Yêu cầu không hợp lệ về nguồn gốc (Origin).' });
        return;
      }
    } catch {
      res.status(403).json({ error: 'Origin không hợp lệ.' });
      return;
    }
  }
  next();
}

export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const cookies = parseCookies(req);
    const payload = verifySessionToken(cookies[SESSION_COOKIE_NAME]);
    if (!payload) {
      res.status(401).json({ error: 'Phiên đăng nhập đã hết hạn hoặc chưa đăng nhập.' });
      return;
    }
    const row = await getUserById(payload.uid);
    if (!row) {
      clearSessionCookie(req, res);
      res.status(401).json({ error: 'Tài khoản không tồn tại.' });
      return;
    }
    if (row.is_locked) {
      clearSessionCookie(req, res);
      res.status(403).json({
        code: 'ACCOUNT_LOCKED',
        error: 'Tài khoản này đã bị khóa bởi quản trị viên.',
      });
      return;
    }
    const tokenSv = typeof payload.sv === 'number' ? payload.sv : 1;
    const dbSv = Number(row.session_version ?? 1);
    if (tokenSv !== dbSv) {
      clearSessionCookie(req, res);
      res.status(401).json({ error: 'Phiên đăng nhập đã hết hiệu lực do thay đổi bảo mật. Vui lòng đăng nhập lại.' });
      return;
    }
    req.authUser = mapDbUserToAuthUser(row);
    next();
  } catch (err) {
    next(err);
  }
}

export function requireAdmin(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void {
  if (!req.authUser || req.authUser.role !== 'admin') {
    res.status(403).json({ error: 'Chỉ quản trị viên mới có quyền thực hiện thao tác này.' });
    return;
  }
  next();
}
