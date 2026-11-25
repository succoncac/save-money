import 'dotenv/config';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import express, { type Request, type Response, type NextFunction } from 'express';
import { initDatabase, dbQuery, dbExecute, dbPipeline } from './server/db';
import {
  clearSessionCookie,
  getUserById,
  hashPassword,
  mapDbUserToAuthUser,
  parseCookies,
  requireAdmin,
  requireAuth,
  SESSION_COOKIE_NAME,
  setSessionCookie,
  signSessionToken,
  signTwoFactorToken,
  verifyMutationOrigin,
  verifyPassword,
  verifySessionToken,
  verifyTwoFactorToken,
  type AuthenticatedRequest,
  type DbUserRow,
} from './server/auth';
import {
  advisorChatWithAi,
  assertSafeExternalUrl,
  getAiSettings,
  listProviderModels,
  scanBillWithAi,
  testAiConnection,
} from './server/ai';
import { authRateLimiter } from './server/rateLimit';
import {
  decryptSecret,
  encryptSecret,
  isEncryptedSecret,
} from './server/cryptoVault';
import {
  canInspectUserCredentials,
  checkAdminSelfAction,
  requiresOldPasswordForAdminReset,
} from './server/adminPolicy';
import {
  buildOtpAuthUri,
  generateBase32Secret,
  generateQrDataUrl,
  generateTotpCode,
  verifyTotpCode,
} from './server/totp';
import { normalizeSerial } from './src/utils/serial';
import { computeCashflowSummary } from './src/utils/cashflow';
import { formatVnd } from './src/utils/currency';
import {
  isValidSafeHttpUrl,
  normalizeNoticeTone,
  parseStoredNoticeLinks,
  sanitizeNoticeLinks,
} from './src/utils/notice';
import type {
  AiProvider,
  ChatMessage,
  SavingsGoal,
  SecurityAlert,
  WalletTransaction,
} from './src/types';

interface DbTxRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  type: string;
  amount: number;
  denomination: number | null;
  serial_number: string | null;
  serial_normalized: string | null;
  method: string;
  note: string;
  ai_confidence: number | null;
  created_at: string;
  updated_at: string;
}

interface DbGoalRow extends Record<string, unknown> {
  user_id: string;
  title: string;
  target_amount: number;
  updated_at: string;
}

interface DbAlertRow extends Record<string, unknown> {
  id: string;
  owner_user_id: string;
  intruder_user_id: string;
  intruder_username: string;
  serial_normalized: string;
  serial_display: string;
  amount: number;
  source: string;
  is_read: number;
  created_at: string;
}

interface DbChatRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  role: string;
  content: string;
  created_at: string;
}

function mapTx(row: DbTxRow): WalletTransaction {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type === 'withdraw' ? 'withdraw' : 'deposit',
    amount: Math.trunc(Number(row.amount) || 0),
    denomination: row.denomination !== null ? Math.trunc(Number(row.denomination)) : null,
    serialNumber: row.serial_number ?? null,
    serialNormalized: row.serial_normalized ?? null,
    method: row.method === 'ai_scan' ? 'ai_scan' : 'manual',
    note: row.note ?? '',
    aiConfidence: row.ai_confidence !== null ? Number(row.ai_confidence) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapGoal(row: DbGoalRow | undefined, userId: string): SavingsGoal {
  if (!row) {
    return {
      userId,
      title: 'Quỹ dự phòng cá nhân',
      targetAmount: 10000000,
      updatedAt: new Date().toISOString(),
    };
  }
  return {
    userId: row.user_id,
    title: row.title,
    targetAmount: Math.trunc(Number(row.target_amount) || 0),
    updatedAt: row.updated_at,
  };
}

function mapAlert(row: DbAlertRow): SecurityAlert {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    intruderUserId: row.intruder_user_id,
    intruderUsername: row.intruder_username,
    serialNormalized: row.serial_normalized,
    serialDisplay: row.serial_display,
    amount: Math.trunc(Number(row.amount) || 0),
    source: row.source,
    isRead: Boolean(row.is_read),
    createdAt: row.created_at,
  };
}

function mapChat(row: DbChatRow): ChatMessage {
  return {
    id: row.id,
    userId: row.user_id,
    role: row.role === 'assistant' ? 'assistant' : 'user',
    content: row.content,
    createdAt: row.created_at,
  };
}

function sanitizePublicError(err: unknown, fallback: string): string {
  if (!(err instanceof Error)) return fallback;
  const msg = err.message.trim();
  if (!msg) return fallback;
  if (
    /turso|libsql|sqlite|\bsql\b|\bhttp\b|turso_database_url|turso_auth_token|econnrefused|fetch failed|enotfound|etimedout/i.test(
      msg,
    )
  ) {
    return fallback;
  }
  return msg;
}

async function checkAndLogSerialConflict(params: {
  serialNormalized: string;
  serialDisplay: string;
  currentUserId: string;
  currentUsername: string;
  amount: number;
  source: 'manual' | 'ai_scan';
  excludeTxId?: string;
}): Promise<{ conflict: boolean; ownerUserId?: string; message?: string }> {
  if (!params.serialNormalized) return { conflict: false };

  const sql = params.excludeTxId
    ? `SELECT user_id FROM user_transactions WHERE serial_normalized = ? AND user_id != ? AND id != ? LIMIT 1`
    : `SELECT user_id FROM user_transactions WHERE serial_normalized = ? AND user_id != ? LIMIT 1`;
  const args = params.excludeTxId
    ? [params.serialNormalized, params.currentUserId, params.excludeTxId]
    : [params.serialNormalized, params.currentUserId];

  const rows = await dbQuery<{ user_id: string }>(sql, args);
  if (rows.length === 0) {
    return { conflict: false };
  }

  const ownerUserId = rows[0].user_id;
  const now = new Date().toISOString();
  const recentThreshold = new Date(Date.now() - 60_000).toISOString();

  // Avoid duplicate spam alerts within 60 seconds for identical actor + serial
  const existingRecent = await dbQuery<{ id: string }>(
    `SELECT id FROM user_security_alerts
     WHERE owner_user_id = ? AND intruder_user_id = ? AND serial_normalized = ? AND created_at >= ?
     LIMIT 1`,
    [ownerUserId, params.currentUserId, params.serialNormalized, recentThreshold],
  );

  if (existingRecent.length === 0) {
    await dbExecute(
      `INSERT INTO user_security_alerts (
        id, owner_user_id, intruder_user_id, intruder_username,
        serial_normalized, serial_display, amount, source, is_read, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      [
        crypto.randomUUID(),
        ownerUserId,
        params.currentUserId,
        params.currentUsername,
        params.serialNormalized,
        params.serialDisplay || params.serialNormalized,
        Math.max(0, Math.trunc(params.amount)),
        params.source,
        now,
      ],
    );
  }

  return {
    conflict: true,
    ownerUserId,
    message: `Cảnh báo chống lấy tiền: Số seri "${params.serialDisplay || params.serialNormalized}" đã thuộc về tài khoản khác. Giao dịch bị chặn và cảnh báo an toàn đã được gửi tới chủ sở hữu gốc.`,
  };
}

async function startServer(): Promise<void> {
  await initDatabase();

  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '6mb' }));
  app.use('/api', verifyMutationOrigin);

  // 1. Health
  app.get('/api/health', async (_req: Request, res: Response) => {
    try {
      await dbQuery('SELECT 1 AS ok');
      res.json({ ok: true, database: 'connected', timestamp: new Date().toISOString() });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'DB error' });
    }
  });

  // 2. Public login notice + initial setup status
  app.get('/api/public/login-notice', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const [settings, adminRows] = await Promise.all([
        getAiSettings(),
        dbQuery<{ id: string }>(
          "SELECT id FROM app_users WHERE is_root_admin = 1 OR username = 'admin' LIMIT 1",
        ),
      ]);
      const envPass = (process.env.ADMIN_INITIAL_PASSWORD || '').trim();
      const hasEnvPass = Boolean(envPass && envPass !== 'CHANGE_ME_INITIAL_ADMIN_PASSWORD');
      const links = parseStoredNoticeLinks(
        settings.login_social_links,
        settings.login_discord_url,
        settings.login_discord_label,
      );
      const firstDiscord = links.find((l) => l.platform === 'discord');
      res.json({
        enabled: settings.login_notice_enabled !== 0,
        tone: normalizeNoticeTone(settings.login_notice_tone),
        badge: settings.login_notice_badge || 'Thông báo',
        title: settings.login_notice_title || '',
        text: settings.login_notice_text || '',
        links,
        discordUrl: firstDiscord?.url || '',
        discordLabel: firstDiscord?.label || '',
        needsInitialAdminSetup: adminRows.length === 0 && !hasEnvPass,
      });
    } catch (err) {
      next(err);
    }
  });

  // 3. One-time bootstrap root admin if ADMIN_INITIAL_PASSWORD is not configured
  app.post('/api/auth/bootstrap-admin', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const envPass = (process.env.ADMIN_INITIAL_PASSWORD || '').trim();
      if (envPass && envPass !== 'CHANGE_ME_INITIAL_ADMIN_PASSWORD') {
        res.status(403).json({ error: 'Tài khoản quản trị gốc được quản lý qua cấu hình môi trường.' });
        return;
      }

      const existing = await dbQuery<{ id: string }>(
        "SELECT id FROM app_users WHERE is_root_admin = 1 OR username = 'admin' LIMIT 1",
      );
      if (existing.length > 0) {
        res.status(409).json({ error: 'Tài khoản quản trị gốc đã được khởi tạo trước đó.' });
        return;
      }

      const { password, confirmPassword } = req.body as {
        password?: string;
        confirmPassword?: string;
      };
      if (typeof password !== 'string' || password.length < 6) {
        res.status(400).json({ error: 'Mật khẩu quản trị gốc phải có ít nhất 6 ký tự.' });
        return;
      }
      if (password !== confirmPassword) {
        res.status(400).json({ error: 'Mật khẩu nhập lại không khớp.' });
        return;
      }

      const now = new Date().toISOString();
      const adminId = crypto.randomUUID();
      const passwordHash = await hashPassword(password);
      const passwordEncrypted = encryptSecret(password);

      await dbPipeline([
        {
          sql: `INSERT INTO app_users (
            id, username, password_hash, password_encrypted, display_name, role, is_root_admin,
            is_locked, must_change_password, can_use_camera, can_use_chat, created_at, updated_at
          ) VALUES (?, 'admin', ?, ?, 'Quản trị gốc', 'admin', 1, 0, 0, 1, 1, ?, ?)`,
          args: [adminId, passwordHash, passwordEncrypted, now, now],
        },
        {
          sql: `INSERT INTO user_goals (user_id, title, target_amount, updated_at)
                VALUES (?, 'Quỹ dự phòng cá nhân', 10000000, ?)`,
          args: [adminId, now],
        },
      ]);

      const token = signSessionToken(adminId, 1);
      setSessionCookie(req, res, token);
      const created = await getUserById(adminId);
      res.status(201).json({
        user: created ? mapDbUserToAuthUser(created) : null,
      });
    } catch (err) {
      next(err);
    }
  });

  // 4. Auth routes
  app.get('/api/auth/session', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const cookies = parseCookies(req);
      const payload = verifySessionToken(cookies[SESSION_COOKIE_NAME]);
      if (!payload) {
        res.status(200).json({ authenticated: false });
        return;
      }
      const row = await getUserById(payload.uid);
      if (!row) {
        clearSessionCookie(req, res);
        res.status(200).json({ authenticated: false });
        return;
      }
      if (row.is_locked) {
        clearSessionCookie(req, res);
        res.status(200).json({
          authenticated: false,
          locked: true,
          message: 'Tài khoản này đã bị khóa bởi quản trị viên.',
        });
        return;
      }
      const tokenSv = typeof payload.sv === 'number' ? payload.sv : 1;
      const dbSv = Number(row.session_version ?? 1);
      if (tokenSv !== dbSv) {
        clearSessionCookie(req, res);
        res.status(200).json({ authenticated: false });
        return;
      }
      res.status(200).json({
        authenticated: true,
        user: mapDbUserToAuthUser(row),
      });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/auth/login', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { username, password } = req.body as { username?: string; password?: string };
      const cleanUser = typeof username === 'string' ? username.trim().toLowerCase() : '';
      if (!cleanUser || typeof password !== 'string' || !password) {
        res.status(400).json({ error: 'Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu.' });
        return;
      }

      const clientIp = req.ip || 'unknown';
      const limitKey = `login:${clientIp}:${cleanUser}`;
      const rate = authRateLimiter.check(limitKey);
      if (!rate.allowed) {
        res.status(429).json({
          error: `Quá nhiều lần đăng nhập sai. Vui lòng thử lại sau ${rate.retryAfterSeconds} giây.`,
        });
        return;
      }

      const rows = await dbQuery<DbUserRow>(
        'SELECT * FROM app_users WHERE LOWER(username) = ? LIMIT 1',
        [cleanUser],
      );
      const user = rows[0];
      if (!user) {
        authRateLimiter.recordFailure(limitKey);
        res.status(401).json({ error: 'Tên đăng nhập hoặc mật khẩu không đúng.' });
        return;
      }

      const valid = await verifyPassword(password, user.password_hash);
      if (!valid) {
        authRateLimiter.recordFailure(limitKey);
        res.status(401).json({ error: 'Tên đăng nhập hoặc mật khẩu không đúng.' });
        return;
      }

      authRateLimiter.clear(limitKey);

      // Backfill encrypted escrow if missing or unencrypted on legacy account
      if (!user.password_encrypted || !isEncryptedSecret(user.password_encrypted)) {
        await dbExecute('UPDATE app_users SET password_encrypted = ? WHERE id = ?', [
          encryptSecret(password),
          user.id,
        ]);
      }

      if (user.is_locked) {
        clearSessionCookie(req, res);
        res.status(403).json({
          code: 'ACCOUNT_LOCKED',
          error: 'Tài khoản này đã bị khóa bởi quản trị viên.',
        });
        return;
      }

      if (Boolean(user.two_factor_enabled) && Boolean(user.two_factor_secret)) {
        const twoFactorToken = signTwoFactorToken(user.id);
        res.json({
          requiresTwoFactor: true,
          twoFactorToken,
        });
        return;
      }

      const token = signSessionToken(user.id, Number(user.session_version ?? 1));
      setSessionCookie(req, res, token);
      res.json({ user: mapDbUserToAuthUser(user) });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/auth/verify-2fa', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { twoFactorToken, code } = req.body as {
        twoFactorToken?: string;
        code?: string;
      };
      const userId = verifyTwoFactorToken(twoFactorToken);
      if (!userId) {
        res.status(401).json({ error: 'Phiên xác minh 2 bước đã hết hạn. Vui lòng đăng nhập lại.' });
        return;
      }

      const clientIp = req.ip || 'unknown';
      const limitKey = `2fa:${clientIp}:${userId}`;
      const rate = authRateLimiter.check(limitKey);
      if (!rate.allowed) {
        res.status(429).json({
          error: `Quá nhiều lần nhập sai mã 2FA. Vui lòng thử lại sau ${rate.retryAfterSeconds} giây.`,
        });
        return;
      }

      const user = await getUserById(userId);
      if (!user) {
        res.status(401).json({ error: 'Tài khoản không tồn tại.' });
        return;
      }
      if (user.is_locked) {
        clearSessionCookie(req, res);
        res.status(403).json({
          code: 'ACCOUNT_LOCKED',
          error: 'Tài khoản này đã bị khóa bởi quản trị viên.',
        });
        return;
      }
      if (!user.two_factor_enabled || !user.two_factor_secret) {
        res.status(400).json({ error: 'Tài khoản chưa kích hoạt xác minh 2 bước.' });
        return;
      }

      const cleanCode = typeof code === 'string' ? code.trim() : '';
      const plainSecret = decryptSecret(user.two_factor_secret);
      if (!plainSecret || !verifyTotpCode(plainSecret, cleanCode)) {
        authRateLimiter.recordFailure(limitKey);
        res.status(401).json({ error: 'Mã xác minh 6 số không đúng hoặc đã hết hạn.' });
        return;
      }

      if (!isEncryptedSecret(user.two_factor_secret)) {
        await dbExecute('UPDATE app_users SET two_factor_secret = ? WHERE id = ?', [
          encryptSecret(plainSecret),
          user.id,
        ]);
      }

      authRateLimiter.clear(limitKey);
      const token = signSessionToken(user.id, Number(user.session_version ?? 1));
      setSessionCookie(req, res, token);
      res.json({ user: mapDbUserToAuthUser(user) });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/auth/logout', (req: Request, res: Response) => {
    clearSessionCookie(req, res);
    res.json({ ok: true });
  });

  app.get('/api/auth/me', requireAuth, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const user = req.authUser!;
      const unreadRows = await dbQuery<{ cnt: number }>(
        'SELECT COUNT(*) AS cnt FROM user_security_alerts WHERE owner_user_id = ? AND is_read = 0',
        [user.id],
      );
      res.json({
        user,
        unreadAlertsCount: Number(unreadRows[0]?.cnt ?? 0),
      });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/auth/change-password', requireAuth, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { oldPassword, newPassword, confirmPassword } = req.body as {
        oldPassword?: string;
        newPassword?: string;
        confirmPassword?: string;
      };
      if (!oldPassword || !newPassword || !confirmPassword) {
        res.status(400).json({ error: 'Vui lòng nhập đầy đủ cả 3 trường mật khẩu.' });
        return;
      }
      if (newPassword.length < 6) {
        res.status(400).json({ error: 'Mật khẩu mới phải có ít nhất 6 ký tự.' });
        return;
      }
      if (newPassword !== confirmPassword) {
        res.status(400).json({ error: 'Mật khẩu mới nhập lại không khớp.' });
        return;
      }
      if (oldPassword === newPassword) {
        res.status(400).json({ error: 'Mật khẩu mới phải khác mật khẩu hiện tại.' });
        return;
      }

      const clientIp = req.ip || 'unknown';
      const limitKey = `chpw:${clientIp}:${req.authUser!.id}`;
      const rate = authRateLimiter.check(limitKey);
      if (!rate.allowed) {
        res.status(429).json({
          error: `Thử sai mật khẩu quá nhiều lần. Vui lòng thử lại sau ${rate.retryAfterSeconds} giây.`,
        });
        return;
      }

      const row = await getUserById(req.authUser!.id);
      if (!row) {
        res.status(404).json({ error: 'Không tìm thấy tài khoản.' });
        return;
      }
      const ok = await verifyPassword(oldPassword, row.password_hash);
      if (!ok) {
        authRateLimiter.recordFailure(limitKey);
        res.status(400).json({ error: 'Mật khẩu cũ không chính xác.' });
        return;
      }
      authRateLimiter.clear(limitKey);

      const newHash = await hashPassword(newPassword);
      const newEncrypted = encryptSecret(newPassword);
      const now = new Date().toISOString();
      const nextSv = Number(row.session_version ?? 1) + 1;
      await dbExecute(
        'UPDATE app_users SET password_hash = ?, password_encrypted = ?, must_change_password = 0, session_version = ?, updated_at = ? WHERE id = ?',
        [newHash, newEncrypted, nextSv, now, row.id],
      );

      setSessionCookie(req, res, signSessionToken(row.id, nextSv));
      const updated = await getUserById(row.id);
      res.json({ user: updated ? mapDbUserToAuthUser(updated) : req.authUser });
    } catch (err) {
      next(err);
    }
  });

  // 4b. Two-Factor Authentication (TOTP) setup / confirm / disable
  app.post('/api/auth/2fa/setup', requireAuth, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { currentPassword } = req.body as { currentPassword?: string };
      if (typeof currentPassword !== 'string' || !currentPassword) {
        res.status(400).json({ error: 'Vui lòng nhập mật khẩu hiện tại để bắt đầu bật 2FA.' });
        return;
      }

      const clientIp = req.ip || 'unknown';
      const limitKey = `2fa-sec:${clientIp}:${req.authUser!.id}`;
      const rate = authRateLimiter.check(limitKey);
      if (!rate.allowed) {
        res.status(429).json({
          error: `Thử sai quá nhiều lần. Vui lòng thử lại sau ${rate.retryAfterSeconds} giây.`,
        });
        return;
      }

      const row = await getUserById(req.authUser!.id);
      if (!row) {
        res.status(404).json({ error: 'Không tìm thấy tài khoản.' });
        return;
      }
      if (row.two_factor_enabled) {
        res.status(400).json({ error: 'Xác minh 2 bước hiện đang được bật cho tài khoản này.' });
        return;
      }

      const passwordOk = await verifyPassword(currentPassword, row.password_hash);
      if (!passwordOk) {
        authRateLimiter.recordFailure(limitKey);
        res.status(400).json({ error: 'Mật khẩu hiện tại không chính xác.' });
        return;
      }
      authRateLimiter.clear(limitKey);

      const secret = generateBase32Secret(20);
      const otpauthUri = buildOtpAuthUri({
        issuer: 'Ví Tiết Kiệm Cá Nhân',
        accountName: row.username,
        secret,
      });
      const qrDataUrl = await generateQrDataUrl(otpauthUri);

      await dbExecute(
        'UPDATE app_users SET two_factor_pending_secret = ?, updated_at = ? WHERE id = ?',
        [encryptSecret(secret), new Date().toISOString(), row.id],
      );

      res.json({ secret, qrDataUrl });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/auth/2fa/confirm', requireAuth, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { currentPassword, code } = req.body as {
        currentPassword?: string;
        code?: string;
      };
      if (typeof currentPassword !== 'string' || !currentPassword) {
        res.status(400).json({ error: 'Vui lòng nhập mật khẩu hiện tại để xác nhận bật 2FA.' });
        return;
      }
      const cleanCode = typeof code === 'string' ? code.trim() : '';
      if (!/^\d{6}$/.test(cleanCode.replace(/\s+/g, ''))) {
        res.status(400).json({ error: 'Vui lòng nhập đúng mã xác minh gồm 6 chữ số.' });
        return;
      }

      const clientIp = req.ip || 'unknown';
      const limitKey = `2fa-sec:${clientIp}:${req.authUser!.id}`;
      const rate = authRateLimiter.check(limitKey);
      if (!rate.allowed) {
        res.status(429).json({
          error: `Thử sai quá nhiều lần. Vui lòng thử lại sau ${rate.retryAfterSeconds} giây.`,
        });
        return;
      }

      const row = await getUserById(req.authUser!.id);
      if (!row) {
        res.status(404).json({ error: 'Không tìm thấy tài khoản.' });
        return;
      }
      if (!row.two_factor_pending_secret) {
        res.status(400).json({ error: 'Chưa có mã thiết lập 2FA. Vui lòng khởi tạo lại mã QR.' });
        return;
      }

      const passwordOk = await verifyPassword(currentPassword, row.password_hash);
      if (!passwordOk) {
        authRateLimiter.recordFailure(limitKey);
        res.status(400).json({ error: 'Mật khẩu xác nhận không chính xác.' });
        return;
      }

      const pendingPlainSecret = decryptSecret(row.two_factor_pending_secret);
      if (!pendingPlainSecret || !verifyTotpCode(pendingPlainSecret, cleanCode)) {
        authRateLimiter.recordFailure(limitKey);
        res.status(400).json({ error: 'Mã 6 số từ ứng dụng xác thực không khớp. Vui lòng thử lại.' });
        return;
      }
      authRateLimiter.clear(limitKey);

      const now = new Date().toISOString();
      const nextSv = Number(row.session_version ?? 1) + 1;
      await dbExecute(
        `UPDATE app_users
         SET two_factor_enabled = 1, two_factor_secret = ?, two_factor_pending_secret = '', session_version = ?, updated_at = ?
         WHERE id = ?`,
        [encryptSecret(pendingPlainSecret), nextSv, now, row.id],
      );

      setSessionCookie(req, res, signSessionToken(row.id, nextSv));
      const updated = await getUserById(row.id);
      res.json({ user: updated ? mapDbUserToAuthUser(updated) : req.authUser });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/auth/2fa/disable', requireAuth, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { currentPassword, code } = req.body as {
        currentPassword?: string;
        code?: string;
      };
      if (typeof currentPassword !== 'string' || !currentPassword) {
        res.status(400).json({ error: 'Vui lòng nhập mật khẩu hiện tại để tắt 2FA.' });
        return;
      }
      const cleanCode = typeof code === 'string' ? code.trim() : '';
      if (!/^\d{6}$/.test(cleanCode.replace(/\s+/g, ''))) {
        res.status(400).json({ error: 'Vui lòng nhập mã xác minh 6 chữ số để tắt 2FA.' });
        return;
      }

      const clientIp = req.ip || 'unknown';
      const limitKey = `2fa-sec:${clientIp}:${req.authUser!.id}`;
      const rate = authRateLimiter.check(limitKey);
      if (!rate.allowed) {
        res.status(429).json({
          error: `Thử sai quá nhiều lần. Vui lòng thử lại sau ${rate.retryAfterSeconds} giây.`,
        });
        return;
      }

      const row = await getUserById(req.authUser!.id);
      if (!row) {
        res.status(404).json({ error: 'Không tìm thấy tài khoản.' });
        return;
      }
      if (!row.two_factor_enabled || !row.two_factor_secret) {
        res.status(400).json({ error: 'Tài khoản này chưa bật xác minh 2 bước.' });
        return;
      }

      const passwordOk = await verifyPassword(currentPassword, row.password_hash);
      if (!passwordOk) {
        authRateLimiter.recordFailure(limitKey);
        res.status(400).json({ error: 'Mật khẩu hiện tại không chính xác.' });
        return;
      }

      const plainSecret = decryptSecret(row.two_factor_secret);
      if (!plainSecret || !verifyTotpCode(plainSecret, cleanCode)) {
        authRateLimiter.recordFailure(limitKey);
        res.status(400).json({ error: 'Mã 6 số từ ứng dụng xác thực không đúng.' });
        return;
      }
      authRateLimiter.clear(limitKey);

      const now = new Date().toISOString();
      const nextSv = Number(row.session_version ?? 1) + 1;
      await dbExecute(
        `UPDATE app_users
         SET two_factor_enabled = 0, two_factor_secret = '', two_factor_pending_secret = '', session_version = ?, updated_at = ?
         WHERE id = ?`,
        [nextSv, now, row.id],
      );

      setSessionCookie(req, res, signSessionToken(row.id, nextSv));
      const updated = await getUserById(row.id);
      res.json({ user: updated ? mapDbUserToAuthUser(updated) : req.authUser });
    } catch (err) {
      next(err);
    }
  });

  // 5. Transactions routes
  app.get('/api/transactions', requireAuth, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.authUser!.id;
      const typeFilter = typeof req.query.type === 'string' ? req.query.type : '';
      const methodFilter = typeof req.query.method === 'string' ? req.query.method : '';
      const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';

      let sql = 'SELECT * FROM user_transactions WHERE user_id = ?';
      const args: Array<string | number> = [userId];

      if (typeFilter === 'deposit' || typeFilter === 'withdraw') {
        sql += ' AND type = ?';
        args.push(typeFilter);
      }
      if (methodFilter === 'manual' || methodFilter === 'ai_scan') {
        sql += ' AND method = ?';
        args.push(methodFilter);
      }
      sql += ' ORDER BY created_at DESC';

      const rows = await dbQuery<DbTxRow>(sql, args);
      let items = rows.map(mapTx);
      if (search) {
        const searchNorm = normalizeSerial(search);
        items = items.filter(
          (tx) =>
            tx.note.toLowerCase().includes(search) ||
            (tx.serialNumber && tx.serialNumber.toLowerCase().includes(search)) ||
            (tx.serialNormalized && searchNorm && tx.serialNormalized.includes(searchNorm)) ||
            String(tx.amount).includes(search),
        );
      }

      res.json({ transactions: items });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/transactions', requireAuth, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const user = req.authUser!;
      const body = req.body as {
        type?: string;
        amount?: unknown;
        denomination?: unknown;
        serialNumber?: string | null;
        method?: string;
        note?: string;
        aiConfidence?: unknown;
        createdAt?: string;
      };

      const type = body.type === 'withdraw' ? 'withdraw' : body.type === 'deposit' ? 'deposit' : null;
      if (!type) {
        res.status(400).json({ error: 'Loại giao dịch phải là deposit hoặc withdraw.' });
        return;
      }

      const amount = typeof body.amount === 'number' ? Math.trunc(body.amount) : NaN;
      if (!Number.isSafeInteger(amount) || amount <= 0) {
        res.status(400).json({ error: 'Số tiền phải là số nguyên dương (VNĐ).' });
        return;
      }

      const method = body.method === 'ai_scan' ? 'ai_scan' : 'manual';
      const denomination =
        typeof body.denomination === 'number' && Number.isSafeInteger(body.denomination) && body.denomination > 0
          ? body.denomination
          : null;
      const serialDisplay =
        typeof body.serialNumber === 'string' && body.serialNumber.trim()
          ? body.serialNumber.trim().slice(0, 40)
          : null;
      const serialNormalized = serialDisplay ? normalizeSerial(serialDisplay) || null : null;
      const note = typeof body.note === 'string' ? body.note.trim().slice(0, 240) : '';
      const aiConfidence =
        typeof body.aiConfidence === 'number' && Number.isFinite(body.aiConfidence)
          ? Math.min(1, Math.max(0, body.aiConfidence))
          : null;

      if (serialNormalized) {
        const conflictCheck = await checkAndLogSerialConflict({
          serialNormalized,
          serialDisplay: serialDisplay || serialNormalized,
          currentUserId: user.id,
          currentUsername: user.username,
          amount,
          source: method,
        });
        if (conflictCheck.conflict) {
          res.status(409).json({
            code: 'SERIAL_CONFLICT',
            error: conflictCheck.message,
          });
          return;
        }
      }

      const now = new Date().toISOString();
      const createdAt =
        typeof body.createdAt === 'string' && !Number.isNaN(Date.parse(body.createdAt))
          ? new Date(body.createdAt).toISOString()
          : now;
      const id = crypto.randomUUID();

      await dbExecute(
        `INSERT INTO user_transactions (
          id, user_id, type, amount, denomination, serial_number, serial_normalized,
          method, note, ai_confidence, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          user.id,
          type,
          amount,
          denomination,
          serialDisplay,
          serialNormalized,
          method,
          note,
          aiConfidence,
          createdAt,
          now,
        ],
      );

      const createdRows = await dbQuery<DbTxRow>('SELECT * FROM user_transactions WHERE id = ? LIMIT 1', [id]);
      res.status(201).json({ transaction: mapTx(createdRows[0]) });
    } catch (err) {
      next(err);
    }
  });

  app.put('/api/transactions/:id', requireAuth, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const user = req.authUser!;
      const txId = req.params.id;
      const existingRows = await dbQuery<DbTxRow>(
        'SELECT * FROM user_transactions WHERE id = ? AND user_id = ? LIMIT 1',
        [txId, user.id],
      );
      if (existingRows.length === 0) {
        res.status(404).json({ error: 'Không tìm thấy giao dịch.' });
        return;
      }

      const body = req.body as {
        type?: string;
        amount?: unknown;
        denomination?: unknown;
        serialNumber?: string | null;
        note?: string;
      };

      const type = body.type === 'withdraw' ? 'withdraw' : 'deposit';
      const amount = typeof body.amount === 'number' ? Math.trunc(body.amount) : NaN;
      if (!Number.isSafeInteger(amount) || amount <= 0) {
        res.status(400).json({ error: 'Số tiền phải là số nguyên dương (VNĐ).' });
        return;
      }

      const denomination =
        typeof body.denomination === 'number' && Number.isSafeInteger(body.denomination) && body.denomination > 0
          ? body.denomination
          : null;
      const serialDisplay =
        typeof body.serialNumber === 'string' && body.serialNumber.trim()
          ? body.serialNumber.trim().slice(0, 40)
          : null;
      const serialNormalized = serialDisplay ? normalizeSerial(serialDisplay) || null : null;
      const note = typeof body.note === 'string' ? body.note.trim().slice(0, 240) : '';

      if (serialNormalized) {
        const conflictCheck = await checkAndLogSerialConflict({
          serialNormalized,
          serialDisplay: serialDisplay || serialNormalized,
          currentUserId: user.id,
          currentUsername: user.username,
          amount,
          source: 'manual',
          excludeTxId: txId,
        });
        if (conflictCheck.conflict) {
          res.status(409).json({
            code: 'SERIAL_CONFLICT',
            error: conflictCheck.message,
          });
          return;
        }
      }

      const now = new Date().toISOString();
      await dbExecute(
        `UPDATE user_transactions
         SET type = ?, amount = ?, denomination = ?, serial_number = ?, serial_normalized = ?, note = ?, updated_at = ?
         WHERE id = ? AND user_id = ?`,
        [type, amount, denomination, serialDisplay, serialNormalized, note, now, txId, user.id],
      );

      const updatedRows = await dbQuery<DbTxRow>('SELECT * FROM user_transactions WHERE id = ? LIMIT 1', [txId]);
      res.json({ transaction: mapTx(updatedRows[0]) });
    } catch (err) {
      next(err);
    }
  });

  app.delete('/api/transactions/:id', requireAuth, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const user = req.authUser!;
      const txId = req.params.id;
      const { affectedRows } = await dbExecute(
        'DELETE FROM user_transactions WHERE id = ? AND user_id = ?',
        [txId, user.id],
      );
      if (affectedRows === 0) {
        res.status(404).json({ error: 'Không tìm thấy giao dịch để xóa.' });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // 6. Goal routes
  app.get('/api/goal', requireAuth, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const rows = await dbQuery<DbGoalRow>('SELECT * FROM user_goals WHERE user_id = ? LIMIT 1', [
        req.authUser!.id,
      ]);
      res.json({ goal: mapGoal(rows[0], req.authUser!.id) });
    } catch (err) {
      next(err);
    }
  });

  app.put('/api/goal', requireAuth, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.authUser!.id;
      const { title, targetAmount } = req.body as { title?: string; targetAmount?: unknown };
      const cleanTitle =
        typeof title === 'string' && title.trim() ? title.trim().slice(0, 120) : 'Mục tiêu tiết kiệm';
      const parsedTarget = typeof targetAmount === 'number' ? Math.trunc(targetAmount) : NaN;
      if (!Number.isSafeInteger(parsedTarget) || parsedTarget <= 0) {
        res.status(400).json({ error: 'Số tiền mục tiêu phải là số nguyên dương (VNĐ).' });
        return;
      }

      const now = new Date().toISOString();
      await dbExecute(
        `INSERT INTO user_goals (user_id, title, target_amount, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           title = excluded.title,
           target_amount = excluded.target_amount,
           updated_at = excluded.updated_at`,
        [userId, cleanTitle, parsedTarget, now],
      );

      res.json({
        goal: {
          userId,
          title: cleanTitle,
          targetAmount: parsedTarget,
          updatedAt: now,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  // 7. Security alerts routes
  app.get('/api/security-alerts', requireAuth, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const rows = await dbQuery<DbAlertRow>(
        'SELECT * FROM user_security_alerts WHERE owner_user_id = ? ORDER BY created_at DESC LIMIT 50',
        [req.authUser!.id],
      );
      res.json({ alerts: rows.map(mapAlert) });
    } catch (err) {
      next(err);
    }
  });

  app.patch('/api/security-alerts/:id/read', requireAuth, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      await dbExecute(
        'UPDATE user_security_alerts SET is_read = 1 WHERE id = ? AND owner_user_id = ?',
        [req.params.id, req.authUser!.id],
      );
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/security-alerts/read-all', requireAuth, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      await dbExecute('UPDATE user_security_alerts SET is_read = 1 WHERE owner_user_id = ?', [
        req.authUser!.id,
      ]);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // 8. AI Scan Bill
  app.post('/api/ai/scan-bill', requireAuth, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const user = req.authUser!;
      if (!user.canUseCamera && user.role !== 'admin') {
        res.status(403).json({ error: 'Tài khoản của bạn không được cấp quyền quét camera AI.' });
        return;
      }

      const { imageDataUrl } = req.body as { imageDataUrl?: string };
      if (typeof imageDataUrl !== 'string' || !imageDataUrl.startsWith('data:image/')) {
        res.status(400).json({ error: 'Vui lòng gửi ảnh tờ tiền hợp lệ.' });
        return;
      }

      const settings = await getAiSettings();
      const result = await scanBillWithAi(settings, imageDataUrl);

      if (result.serialNormalized) {
        const conflictCheck = await checkAndLogSerialConflict({
          serialNormalized: result.serialNormalized,
          serialDisplay: result.serialNumber || result.serialNormalized,
          currentUserId: user.id,
          currentUsername: user.username,
          amount: result.denomination ?? 0,
          source: 'ai_scan',
        });
        if (conflictCheck.conflict) {
          result.serialConflict = {
            isConflict: true,
            message: conflictCheck.message || 'Số seri đã tồn tại ở tài khoản khác.',
          };
        }
      }

      res.json(result);
    } catch (err) {
      console.error('[AI Scan Error]', err);
      res.status(502).json({
        error: sanitizePublicError(err, 'Không thể phân tích ảnh tờ tiền lúc này.'),
      });
    }
  });

  // 9. AI Advisor Chat
  app.get('/api/advisor/messages', requireAuth, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const rows = await dbQuery<DbChatRow>(
        'SELECT * FROM user_chat_messages WHERE user_id = ? ORDER BY created_at ASC LIMIT 100',
        [req.authUser!.id],
      );
      res.json({ messages: rows.map(mapChat) });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/advisor/chat', requireAuth, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const user = req.authUser!;
      if (!user.canUseChat && user.role !== 'admin') {
        res.status(403).json({ error: 'Tài khoản của bạn không được cấp quyền Trợ lý AI.' });
        return;
      }

      const { message } = req.body as { message?: string };
      const cleanMessage = typeof message === 'string' ? message.trim().slice(0, 1500) : '';
      if (!cleanMessage) {
        res.status(400).json({ error: 'Vui lòng nhập nội dung câu hỏi tài chính.' });
        return;
      }

      const [txRows, goalRows, historyRows, settings] = await Promise.all([
        dbQuery<DbTxRow>('SELECT * FROM user_transactions WHERE user_id = ? ORDER BY created_at DESC', [
          user.id,
        ]),
        dbQuery<DbGoalRow>('SELECT * FROM user_goals WHERE user_id = ? LIMIT 1', [user.id]),
        dbQuery<DbChatRow>(
          'SELECT * FROM user_chat_messages WHERE user_id = ? ORDER BY created_at ASC LIMIT 20',
          [user.id],
        ),
        getAiSettings(),
      ]);

      const txs = txRows.map(mapTx);
      const goal = mapGoal(goalRows[0], user.id);
      const summary = computeCashflowSummary(txs);
      const progressPct =
        goal.targetAmount > 0
          ? Math.min(100, Math.round((summary.netBalance / goal.targetAmount) * 100))
          : 0;

      const financialContext = [
        `- Người dùng: ${user.displayName} (@${user.username})`,
        `- Số dư ròng hiện tại: ${formatVnd(summary.netBalance)}`,
        `- Tổng đã nạp: ${formatVnd(summary.totalDeposits)} | Tổng đã rút: ${formatVnd(summary.totalWithdrawals)}`,
        `- Nạp hôm nay: ${formatVnd(summary.todayDeposits)} | Nạp tháng này: ${formatVnd(summary.monthDeposits)}`,
        `- Mục tiêu "${goal.title}": ${formatVnd(goal.targetAmount)} (đạt ${progressPct}%)`,
        `- Số giao dịch: ${txs.length}`,
      ].join('\n');

      const history = historyRows.map((h) => ({
        role: (h.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
        content: h.content,
      }));

      const reply = await advisorChatWithAi(settings, financialContext, history, cleanMessage);
      const userTime = new Date().toISOString();
      const assistantTime = new Date(Date.now() + 5).toISOString();
      const userMsgId = crypto.randomUUID();
      const assistantMsgId = crypto.randomUUID();

      await dbPipeline([
        {
          sql: 'INSERT INTO user_chat_messages (id, user_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)',
          args: [userMsgId, user.id, 'user', cleanMessage, userTime],
        },
        {
          sql: 'INSERT INTO user_chat_messages (id, user_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)',
          args: [assistantMsgId, user.id, 'assistant', reply, assistantTime],
        },
      ]);

      res.json({
        userMessage: {
          id: userMsgId,
          userId: user.id,
          role: 'user',
          content: cleanMessage,
          createdAt: userTime,
        },
        assistantMessage: {
          id: assistantMsgId,
          userId: user.id,
          role: 'assistant',
          content: reply,
          createdAt: assistantTime,
        },
      });
    } catch (err) {
      console.error('[AI Advisor Error]', err);
      res.status(502).json({
        error: sanitizePublicError(err, 'Trợ lý AI hiện không phản hồi.'),
      });
    }
  });

  app.delete('/api/advisor/messages', requireAuth, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      await dbExecute('DELETE FROM user_chat_messages WHERE user_id = ?', [req.authUser!.id]);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // 10. Admin routes (requireAdmin)
  app.get('/api/admin/users', requireAuth, requireAdmin, async (_req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const rows = await dbQuery<DbUserRow>(
        'SELECT * FROM app_users ORDER BY is_root_admin DESC, created_at ASC',
      );
      res.json({ users: rows.map(mapDbUserToAuthUser) });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/admin/users', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { username, displayName, password, role, canUseCamera, canUseChat } = req.body as {
        username?: string;
        displayName?: string;
        password?: string;
        role?: string;
        canUseCamera?: boolean;
        canUseChat?: boolean;
      };

      const cleanUsername = typeof username === 'string' ? username.trim().toLowerCase() : '';
      if (!/^[a-z0-9_.-]{3,32}$/.test(cleanUsername)) {
        res.status(400).json({
          error: 'Tên đăng nhập gồm 3-32 ký tự chữ thường, số, dấu gạch dưới hoặc dấu chấm.',
        });
        return;
      }

      if (typeof password !== 'string' || password.length < 6) {
        res.status(400).json({ error: 'Mật khẩu khởi tạo phải có ít nhất 6 ký tự.' });
        return;
      }

      const existing = await dbQuery<{ id: string }>(
        'SELECT id FROM app_users WHERE LOWER(username) = ? LIMIT 1',
        [cleanUsername],
      );
      if (existing.length > 0) {
        res.status(409).json({ error: 'Tên đăng nhập này đã tồn tại.' });
        return;
      }

      const cleanDisplay =
        typeof displayName === 'string' && displayName.trim()
          ? displayName.trim().slice(0, 80)
          : cleanUsername;
      const cleanRole = role === 'admin' ? 'admin' : 'user';
      const now = new Date().toISOString();
      const userId = crypto.randomUUID();
      const passwordHash = await hashPassword(password);
      const passwordEncrypted = encryptSecret(password);

      await dbPipeline([
        {
          sql: `INSERT INTO app_users (
            id, username, password_hash, password_encrypted, display_name, role, is_root_admin,
            is_locked, must_change_password, can_use_camera, can_use_chat, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, 1, ?, ?, ?, ?)`,
          args: [
            userId,
            cleanUsername,
            passwordHash,
            passwordEncrypted,
            cleanDisplay,
            cleanRole,
            canUseCamera === false ? 0 : 1,
            canUseChat === false ? 0 : 1,
            now,
            now,
          ],
        },
        {
          sql: `INSERT INTO user_goals (user_id, title, target_amount, updated_at)
                VALUES (?, 'Mục tiêu tiết kiệm', 10000000, ?)`,
          args: [userId, now],
        },
      ]);

      const created = await getUserById(userId);
      res.status(201).json({ user: created ? mapDbUserToAuthUser(created) : null });
    } catch (err) {
      next(err);
    }
  });

  app.put('/api/admin/users/:id', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const actor = req.authUser!;
      const target = await getUserById(req.params.id);
      if (!target) {
        res.status(404).json({ error: 'Không tìm thấy tài khoản.' });
        return;
      }

      const { displayName, role, isLocked } = req.body as {
        displayName?: string;
        role?: string;
        isLocked?: boolean;
      };

      // Root admin protection on backend
      if (target.is_root_admin) {
        if (isLocked === true || role === 'user') {
          res.status(403).json({
            error: 'Tài khoản Quản trị gốc được bảo vệ: không thể khóa hoặc hạ quyền.',
          });
          return;
        }
        if (!actor.isRootAdmin) {
          res.status(403).json({
            error: 'Admin phụ không thể chỉnh sửa tài khoản Quản trị gốc.',
          });
          return;
        }
      }

      if (isLocked === true) {
        const lockDecision = checkAdminSelfAction({
          actorId: actor.id,
          targetId: target.id,
          action: 'lock',
        });
        if (!lockDecision.allowed) {
          res.status(lockDecision.status).json({ error: lockDecision.error });
          return;
        }
      }
      if (role !== undefined && role !== 'admin') {
        const demoteDecision = checkAdminSelfAction({
          actorId: actor.id,
          targetId: target.id,
          action: 'demote',
        });
        if (!demoteDecision.allowed) {
          res.status(demoteDecision.status).json({ error: demoteDecision.error });
          return;
        }
      }

      const nextDisplay =
        typeof displayName === 'string' && displayName.trim()
          ? displayName.trim().slice(0, 80)
          : target.display_name;
      const nextRole = target.is_root_admin ? 'admin' : role === 'admin' ? 'admin' : 'user';
      const nextLocked = target.is_root_admin ? 0 : isLocked ? 1 : 0;
      const now = new Date().toISOString();

      await dbExecute(
        'UPDATE app_users SET display_name = ?, role = ?, is_locked = ?, updated_at = ? WHERE id = ?',
        [nextDisplay, nextRole, nextLocked, now, target.id],
      );

      const updated = await getUserById(target.id);
      res.json({ user: updated ? mapDbUserToAuthUser(updated) : null });
    } catch (err) {
      next(err);
    }
  });

  app.patch('/api/admin/users/:id/permissions', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const actor = req.authUser!;
      const target = await getUserById(req.params.id);
      if (!target) {
        res.status(404).json({ error: 'Không tìm thấy tài khoản.' });
        return;
      }
      if (target.is_root_admin && !actor.isRootAdmin) {
        res.status(403).json({
          error: 'Admin phụ không thể thay đổi quyền của Quản trị gốc.',
        });
        return;
      }

      const { canUseCamera, canUseChat } = req.body as {
        canUseCamera?: boolean;
        canUseChat?: boolean;
      };
      const nextCam =
        typeof canUseCamera === 'boolean' ? (canUseCamera ? 1 : 0) : target.can_use_camera;
      const nextChat =
        typeof canUseChat === 'boolean' ? (canUseChat ? 1 : 0) : target.can_use_chat;

      await dbExecute(
        'UPDATE app_users SET can_use_camera = ?, can_use_chat = ?, updated_at = ? WHERE id = ?',
        [nextCam, nextChat, new Date().toISOString(), target.id],
      );

      const updated = await getUserById(target.id);
      res.json({ user: updated ? mapDbUserToAuthUser(updated) : null });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/admin/users/bulk-permissions', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { canUseCamera, canUseChat } = req.body as {
        canUseCamera?: boolean;
        canUseChat?: boolean;
      };
      const sets: string[] = [];
      const args: Array<string | number> = [];

      if (typeof canUseCamera === 'boolean') {
        sets.push('can_use_camera = ?');
        args.push(canUseCamera ? 1 : 0);
      }
      if (typeof canUseChat === 'boolean') {
        sets.push('can_use_chat = ?');
        args.push(canUseChat ? 1 : 0);
      }
      if (sets.length === 0) {
        res.status(400).json({ error: 'Không có quyền nào được chọn để cập nhật.' });
        return;
      }

      sets.push('updated_at = ?');
      args.push(new Date().toISOString());

      // Never overwrite root admin permissions in bulk action
      await dbExecute(
        `UPDATE app_users SET ${sets.join(', ')} WHERE is_root_admin = 0`,
        args,
      );

      const rows = await dbQuery<DbUserRow>(
        'SELECT * FROM app_users ORDER BY is_root_admin DESC, created_at ASC',
      );
      res.json({ users: rows.map(mapDbUserToAuthUser) });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/admin/users/:id/reset-password', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const actor = req.authUser!;
      const target = await getUserById(req.params.id);
      if (!target) {
        res.status(404).json({ error: 'Không tìm thấy tài khoản.' });
        return;
      }
      if (target.is_root_admin && !actor.isRootAdmin) {
        res.status(403).json({
          error: 'Admin phụ không thể đặt lại mật khẩu của Quản trị gốc.',
        });
        return;
      }

      const { newPassword, oldPassword } = req.body as {
        newPassword?: string;
        oldPassword?: string;
      };
      if (typeof newPassword !== 'string' || newPassword.length < 6) {
        res.status(400).json({ error: 'Mật khẩu mới phải có ít nhất 6 ký tự.' });
        return;
      }

      const isSelfReset = requiresOldPasswordForAdminReset(actor.id, target.id);
      if (isSelfReset) {
        if (typeof oldPassword !== 'string' || !oldPassword) {
          res.status(400).json({ error: 'Không thể tự đổi mật khẩu mà không có mật khẩu cũ.' });
          return;
        }
        const oldOk = await verifyPassword(oldPassword, target.password_hash);
        if (!oldOk) {
          res.status(400).json({ error: 'Mật khẩu cũ không chính xác.' });
          return;
        }
        if (newPassword === oldPassword) {
          res.status(400).json({ error: 'Mật khẩu mới phải khác mật khẩu hiện tại.' });
          return;
        }
      }

      const hash = await hashPassword(newPassword);
      const encrypted = encryptSecret(newPassword);
      const nextSv = Number(target.session_version ?? 1) + 1;
      await dbExecute(
        'UPDATE app_users SET password_hash = ?, password_encrypted = ?, must_change_password = ?, session_version = ?, updated_at = ? WHERE id = ?',
        [hash, encrypted, isSelfReset ? 0 : 1, nextSv, new Date().toISOString(), target.id],
      );
      if (isSelfReset) {
        setSessionCookie(req, res, signSessionToken(target.id, nextSv));
      }
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/admin/users/:id/credentials', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const actor = req.authUser!;
      const target = await getUserById(req.params.id);
      if (!target) {
        res.status(404).json({ error: 'Không tìm thấy tài khoản.' });
        return;
      }

      const acl = canInspectUserCredentials(
        { id: actor.id, isRootAdmin: actor.isRootAdmin },
        { id: target.id, role: target.role, isRootAdmin: Boolean(target.is_root_admin) },
      );
      if (!acl.allowed) {
        res.status(acl.status).json({ error: acl.error });
        return;
      }

      const { adminPassword } = req.body as { adminPassword?: string };
      if (typeof adminPassword !== 'string' || !adminPassword) {
        res.status(400).json({ error: 'Vui lòng nhập mật khẩu quản trị của bạn để xác nhận.' });
        return;
      }

      const clientIp = req.ip || 'unknown';
      const limitKey = `admin-cred:${clientIp}:${actor.id}`;
      const rate = authRateLimiter.check(limitKey);
      if (!rate.allowed) {
        res.status(429).json({
          error: `Thử sai quá nhiều lần. Vui lòng thử lại sau ${rate.retryAfterSeconds} giây.`,
        });
        return;
      }

      const actorRow = await getUserById(actor.id);
      if (!actorRow) {
        res.status(401).json({ error: 'Không tìm thấy phiên quản trị.' });
        return;
      }

      const passwordOk = await verifyPassword(adminPassword, actorRow.password_hash);
      if (!passwordOk) {
        authRateLimiter.recordFailure(limitKey);
        res.status(401).json({ error: 'Mật khẩu xác nhận không chính xác.' });
        return;
      }
      authRateLimiter.clear(limitKey);

      const decryptedPassword = target.password_encrypted
        ? decryptSecret(target.password_encrypted)
        : null;

      let twoFactorInfo: {
        enabled: boolean;
        currentCode: string | null;
        remainingSeconds: number;
        secret: string | null;
        qrDataUrl: string | null;
      } = {
        enabled: Boolean(target.two_factor_enabled),
        currentCode: null,
        remainingSeconds: 30 - (Math.floor(Date.now() / 1000) % 30),
        secret: null,
        qrDataUrl: null,
      };

      if (Boolean(target.two_factor_enabled) && target.two_factor_secret) {
        const plain2fa = decryptSecret(target.two_factor_secret);
        if (plain2fa) {
          const uri = buildOtpAuthUri({
            issuer: 'Ví Tiết Kiệm Cá Nhân',
            accountName: target.username,
            secret: plain2fa,
          });
          const qrDataUrl = await generateQrDataUrl(uri);
          twoFactorInfo = {
            enabled: true,
            currentCode: generateTotpCode(plain2fa),
            remainingSeconds: 30 - (Math.floor(Date.now() / 1000) % 30),
            secret: plain2fa,
            qrDataUrl,
          };
        }
      }

      res.json({
        user: {
          id: target.id,
          username: target.username,
          displayName: target.display_name,
          role: target.role === 'admin' ? 'admin' : 'user',
          isRootAdmin: Boolean(target.is_root_admin),
          twoFactorEnabled: Boolean(target.two_factor_enabled),
        },
        password: decryptedPassword,
        passwordStatus: decryptedPassword ? 'available' : 'scrypt_only',
        twoFactor: twoFactorInfo,
      });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/admin/users/:id/disable-2fa', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const actor = req.authUser!;
      const target = await getUserById(req.params.id);
      if (!target) {
        res.status(404).json({ error: 'Không tìm thấy tài khoản.' });
        return;
      }
      if (target.is_root_admin && !actor.isRootAdmin) {
        res.status(403).json({
          error: 'Admin phụ không thể tắt xác minh 2 bước của Quản trị gốc.',
        });
        return;
      }

      const nextSv = Number(target.session_version ?? 1) + 1;
      await dbExecute(
        `UPDATE app_users
         SET two_factor_enabled = 0, two_factor_secret = '', two_factor_pending_secret = '', session_version = ?, updated_at = ?
         WHERE id = ?`,
        [nextSv, new Date().toISOString(), target.id],
      );
      if (actor.id === target.id) {
        setSessionCookie(req, res, signSessionToken(target.id, nextSv));
      }
      const updated = await getUserById(target.id);
      res.json({ user: updated ? mapDbUserToAuthUser(updated) : null });
    } catch (err) {
      next(err);
    }
  });

  app.delete('/api/admin/users/:id', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const actor = req.authUser!;
      const target = await getUserById(req.params.id);
      if (!target) {
        res.status(404).json({ error: 'Không tìm thấy tài khoản.' });
        return;
      }
      if (target.is_root_admin) {
        res.status(403).json({ error: 'Không thể xóa tài khoản Quản trị gốc.' });
        return;
      }
      const deleteDecision = checkAdminSelfAction({
        actorId: actor.id,
        targetId: target.id,
        action: 'delete',
      });
      if (!deleteDecision.allowed) {
        res.status(deleteDecision.status).json({ error: deleteDecision.error });
        return;
      }

      await dbPipeline([
        { sql: 'DELETE FROM user_transactions WHERE user_id = ?', args: [target.id] },
        { sql: 'DELETE FROM user_goals WHERE user_id = ?', args: [target.id] },
        { sql: 'DELETE FROM user_chat_messages WHERE user_id = ?', args: [target.id] },
        { sql: 'DELETE FROM user_security_alerts WHERE owner_user_id = ?', args: [target.id] },
        { sql: 'DELETE FROM app_users WHERE id = ?', args: [target.id] },
      ]);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // 11. Admin AI & Login Notice settings
  app.get('/api/admin/ai-settings', requireAuth, requireAdmin, async (_req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const s = await getAiSettings();
      const loginSocialLinks = parseStoredNoticeLinks(
        s.login_social_links,
        s.login_discord_url,
        s.login_discord_label,
      );
      res.json({
        settings: {
          provider: (s.provider || 'server_default') as AiProvider,
          hasApiKey: Boolean(s.api_key && s.api_key.trim().length > 0),
          baseUrl: s.base_url || '',
          chatModel: s.chat_model || 'gemini-4-hydrogen',
          visionModel: s.vision_model || 'auto',
          loginNoticeEnabled: s.login_notice_enabled !== 0,
          loginNoticeTone: normalizeNoticeTone(s.login_notice_tone),
          loginNoticeBadge: s.login_notice_badge || 'Thông báo',
          loginNoticeTitle: s.login_notice_title || '',
          loginNoticeText: s.login_notice_text || '',
          loginSocialLinks,
          updatedAt: s.updated_at,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  app.put('/api/admin/ai-settings', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const current = await getAiSettings();
      const body = req.body as {
        provider?: string;
        apiKey?: string;
        clearApiKey?: boolean;
        baseUrl?: string;
        chatModel?: string;
        visionModel?: string;
        loginNoticeEnabled?: boolean;
        loginNoticeTone?: string;
        loginNoticeBadge?: string;
        loginNoticeTitle?: string;
        loginNoticeText?: string;
        loginSocialLinks?: unknown;
      };

      const allowedProviders: AiProvider[] = [
        'server_default',
        'openai_compatible',
        'gemini',
        'openai',
        'anthropic',
      ];
      const provider = allowedProviders.includes(body.provider as AiProvider)
        ? (body.provider as AiProvider)
        : (current.provider as AiProvider);

      let baseUrl = typeof body.baseUrl === 'string' ? body.baseUrl.trim() : current.base_url;
      if (provider === 'openai_compatible' && baseUrl) {
        baseUrl = assertSafeExternalUrl(baseUrl);
      } else if (provider === 'anthropic' && baseUrl) {
        baseUrl = assertSafeExternalUrl(baseUrl);
      }

      let apiKey = current.api_key;
      if (body.clearApiKey) {
        apiKey = '';
      } else if (typeof body.apiKey === 'string' && body.apiKey.trim()) {
        apiKey = body.apiKey.trim();
      }

      const chatModel =
        typeof body.chatModel === 'string' && body.chatModel.trim()
          ? body.chatModel.trim().slice(0, 120)
          : current.chat_model;
      const visionModel =
        typeof body.visionModel === 'string' && body.visionModel.trim()
          ? body.visionModel.trim().slice(0, 120)
          : 'auto';

      const loginNoticeEnabled =
        typeof body.loginNoticeEnabled === 'boolean'
          ? body.loginNoticeEnabled
          : current.login_notice_enabled !== 0;
      const loginNoticeTone =
        typeof body.loginNoticeTone === 'string'
          ? normalizeNoticeTone(body.loginNoticeTone)
          : normalizeNoticeTone(current.login_notice_tone);
      const loginNoticeBadge =
        typeof body.loginNoticeBadge === 'string'
          ? body.loginNoticeBadge.trim().slice(0, 40)
          : current.login_notice_badge;
      const loginNoticeTitle =
        typeof body.loginNoticeTitle === 'string'
          ? body.loginNoticeTitle.trim().slice(0, 120)
          : current.login_notice_title;
      const loginNoticeText =
        typeof body.loginNoticeText === 'string'
          ? body.loginNoticeText.trim().slice(0, 1000)
          : current.login_notice_text;

      let loginSocialLinks = parseStoredNoticeLinks(
        current.login_social_links,
        current.login_discord_url,
        current.login_discord_label,
      );
      if (body.loginSocialLinks !== undefined) {
        if (!Array.isArray(body.loginSocialLinks)) {
          res.status(400).json({ error: 'Danh sách liên kết mạng xã hội không hợp lệ.' });
          return;
        }
        for (const item of body.loginSocialLinks) {
          if (item && typeof item === 'object' && typeof (item as Record<string, unknown>).url === 'string') {
            const rawUrl = String((item as Record<string, unknown>).url).trim();
            if (rawUrl && !isValidSafeHttpUrl(rawUrl)) {
              res.status(400).json({ error: 'Tất cả liên kết mạng xã hội phải bắt đầu bằng https:// hoặc http://.' });
              return;
            }
          }
        }
        loginSocialLinks = sanitizeNoticeLinks(body.loginSocialLinks);
      }

      const encryptedApiKeyToStore = apiKey
        ? (isEncryptedSecret(apiKey) ? apiKey : encryptSecret(apiKey))
        : '';

      const firstDiscord = loginSocialLinks.find((l) => l.platform === 'discord');
      const now = new Date().toISOString();
      await dbExecute(
        `UPDATE app_ai_settings
         SET provider = ?, api_key = ?, base_url = ?, chat_model = ?, vision_model = ?,
             login_notice_enabled = ?, login_notice_tone = ?, login_notice_badge = ?, login_notice_title = ?, login_notice_text = ?,
             login_discord_url = ?, login_discord_label = ?, login_social_links = ?, updated_at = ?
         WHERE id = 1`,
        [
          provider,
          encryptedApiKeyToStore,
          baseUrl,
          chatModel,
          visionModel,
          loginNoticeEnabled ? 1 : 0,
          loginNoticeTone,
          loginNoticeBadge,
          loginNoticeTitle,
          loginNoticeText,
          firstDiscord?.url || '',
          firstDiscord?.label || '',
          JSON.stringify(loginSocialLinks),
          now,
        ],
      );

      res.json({
        settings: {
          provider,
          hasApiKey: Boolean(apiKey),
          baseUrl,
          chatModel,
          visionModel,
          loginNoticeEnabled,
          loginNoticeTone,
          loginNoticeBadge,
          loginNoticeTitle,
          loginNoticeText,
          loginSocialLinks,
          updatedAt: now,
        },
      });
    } catch (err) {
      res.status(400).json({
        error: sanitizePublicError(err, 'Không thể lưu cấu hình AI.'),
      });
    }
  });

  app.post('/api/admin/ai-models', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const current = await getAiSettings();
      const { provider, apiKey, baseUrl } = req.body as {
        provider?: AiProvider;
        apiKey?: string;
        baseUrl?: string;
      };
      const effectiveProvider = provider || (current.provider as AiProvider);
      const effectiveKey =
        typeof apiKey === 'string' && apiKey.trim() ? apiKey.trim() : current.api_key;
      const effectiveBaseUrl =
        typeof baseUrl === 'string' && baseUrl.trim() ? baseUrl.trim() : current.base_url;

      const models = await listProviderModels({
        provider: effectiveProvider,
        apiKey: effectiveKey,
        baseUrl: effectiveBaseUrl,
      });
      res.json({ models });
    } catch (err) {
      res.status(400).json({
        error: sanitizePublicError(err, 'Không thể lấy danh sách model.'),
      });
    }
  });

  app.post('/api/admin/ai-test', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const current = await getAiSettings();
      const body = req.body as {
        provider?: AiProvider;
        apiKey?: string;
        clearApiKey?: boolean;
        baseUrl?: string;
        chatModel?: string;
      };
      const effectiveProvider = body.provider || (current.provider as AiProvider);
      const effectiveBaseUrl =
        typeof body.baseUrl === 'string' && body.baseUrl.trim()
          ? assertSafeExternalUrl(body.baseUrl)
          : current.base_url;
      const effectiveKey = body.clearApiKey
        ? ''
        : typeof body.apiKey === 'string' && body.apiKey.trim()
          ? body.apiKey.trim()
          : current.api_key;
      const effectiveChatModel =
        typeof body.chatModel === 'string' && body.chatModel.trim()
          ? body.chatModel.trim().slice(0, 120)
          : current.chat_model;

      const result = await testAiConnection({
        ...current,
        provider: effectiveProvider,
        api_key: effectiveKey,
        base_url: effectiveBaseUrl,
        chat_model: effectiveChatModel,
      });
      res.json(result);
    } catch (err) {
      res.status(400).json({
        error: sanitizePublicError(err, 'Kiểm tra kết nối AI thất bại.'),
      });
    }
  });

  // Global API error handler
  app.use('/api', (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[API Error]', err);
    res.status(500).json({
      error: sanitizePublicError(err, 'Hệ thống đang bận hoặc tạm gián đoạn. Vui lòng thử lại sau.'),
    });
  });

  // Vite dev middleware or static dist serving
  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Not found');
      }
    });
  }

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`Ví Tiết Kiệm Cá Nhân listening on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
