// server.ts
import "dotenv/config";
import crypto5 from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import express from "express";

// server/auth.ts
import crypto2 from "node:crypto";
var SESSION_COOKIE_NAME = "vtk_session";
var SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
var FALLBACK_SESSION_SECRET = crypto2.randomBytes(32).toString("hex");
function getSessionSecret() {
  const configured = (process.env.SESSION_SECRET || "").trim();
  if (configured && configured !== "CHANGE_ME_TO_A_LONG_RANDOM_SECRET") {
    return configured;
  }
  return FALLBACK_SESSION_SECRET;
}
async function hashPassword(password) {
  const salt = crypto2.randomBytes(16).toString("hex");
  const derived = await new Promise((resolve, reject) => {
    crypto2.scrypt(password, salt, 64, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
  return `${salt}:${derived.toString("hex")}`;
}
async function verifyPassword(password, storedHash) {
  const parts = storedHash.split(":");
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  if (!salt || !keyHex) return false;
  const expected = Buffer.from(keyHex, "hex");
  const derived = await new Promise((resolve, reject) => {
    crypto2.scrypt(password, salt, 64, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
  if (expected.length !== derived.length) return false;
  return crypto2.timingSafeEqual(expected, derived);
}
function signSessionToken(userId, sessionVersion = 1) {
  const nowSec = Math.floor(Date.now() / 1e3);
  const payload = {
    uid: userId,
    sv: Math.max(1, Math.trunc(sessionVersion)),
    iat: nowSec,
    exp: nowSec + SESSION_TTL_SECONDS
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = crypto2.createHmac("sha256", getSessionSecret()).update(payloadB64).digest("base64url");
  return `${payloadB64}.${sig}`;
}
function verifySessionToken(token) {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;
  if (!payloadB64 || !sigB64) return null;
  const expectedSig = crypto2.createHmac("sha256", getSessionSecret()).update(payloadB64).digest("base64url");
  const sigBuf = Buffer.from(sigB64);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto2.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
    if (!parsed.uid || typeof parsed.exp !== "number") return null;
    if (Math.floor(Date.now() / 1e3) > parsed.exp) return null;
    return parsed;
  } catch {
    return null;
  }
}
var TWO_FACTOR_TOKEN_TTL_SECONDS = 5 * 60;
function signTwoFactorToken(userId) {
  const nowSec = Math.floor(Date.now() / 1e3);
  const payload = {
    uid: userId,
    purpose: "2fa_login",
    iat: nowSec,
    exp: nowSec + TWO_FACTOR_TOKEN_TTL_SECONDS
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = crypto2.createHmac("sha256", getSessionSecret()).update(`2fa:${payloadB64}`).digest("base64url");
  return `${payloadB64}.${sig}`;
}
function verifyTwoFactorToken(token) {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;
  if (!payloadB64 || !sigB64) return null;
  const expectedSig = crypto2.createHmac("sha256", getSessionSecret()).update(`2fa:${payloadB64}`).digest("base64url");
  const sigBuf = Buffer.from(sigB64);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto2.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
    if (parsed.purpose !== "2fa_login" || !parsed.uid || typeof parsed.exp !== "number") {
      return null;
    }
    if (Math.floor(Date.now() / 1e3) > parsed.exp) return null;
    return parsed.uid;
  } catch {
    return null;
  }
}
function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};
  const map = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
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
function isHttpsRequest(req) {
  const proto = req.headers["x-forwarded-proto"];
  if (typeof proto === "string" && proto.split(",")[0].trim() === "https") {
    return true;
  }
  if (req.secure) return true;
  const origin = req.headers.origin;
  if (typeof origin === "string" && origin.startsWith("https://")) {
    return true;
  }
  return false;
}
function setSessionCookie(req, res, token) {
  const isHttps = isHttpsRequest(req);
  const attrs = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    `Max-Age=${SESSION_TTL_SECONDS}`
  ];
  if (isHttps) {
    attrs.push("SameSite=None", "Secure", "Partitioned");
  } else {
    attrs.push("SameSite=Lax");
  }
  res.setHeader("Set-Cookie", attrs.join("; "));
}
function clearSessionCookie(req, res) {
  const isHttps = isHttpsRequest(req);
  const attrs = [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "Max-Age=0"
  ];
  if (isHttps) {
    attrs.push("SameSite=None", "Secure", "Partitioned");
  } else {
    attrs.push("SameSite=Lax");
  }
  res.setHeader("Set-Cookie", attrs.join("; "));
}
function mapDbUserToAuthUser(row) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role === "admin" ? "admin" : "user",
    isRootAdmin: Boolean(row.is_root_admin),
    isLocked: Boolean(row.is_locked),
    mustChangePassword: Boolean(row.must_change_password),
    canUseCamera: Boolean(row.can_use_camera),
    canUseChat: Boolean(row.can_use_chat),
    twoFactorEnabled: Boolean(row.two_factor_enabled),
    createdAt: row.created_at
  };
}
async function getUserById(userId) {
  const rows = await dbQuery("SELECT * FROM app_users WHERE id = ? LIMIT 1", [userId]);
  return rows[0] ?? null;
}
function verifyMutationOrigin(req, res, next) {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    next();
    return;
  }
  const origin = req.headers.origin;
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  if (origin && host) {
    try {
      const originHost = new URL(origin).host;
      if (originHost !== host && req.headers["x-requested-with"] !== "XMLHttpRequest") {
        res.status(403).json({ error: "Y\xEAu c\u1EA7u kh\xF4ng h\u1EE3p l\u1EC7 v\u1EC1 ngu\u1ED3n g\u1ED1c (Origin)." });
        return;
      }
    } catch {
      res.status(403).json({ error: "Origin kh\xF4ng h\u1EE3p l\u1EC7." });
      return;
    }
  }
  next();
}
async function requireAuth(req, res, next) {
  try {
    const cookies = parseCookies(req);
    const payload = verifySessionToken(cookies[SESSION_COOKIE_NAME]);
    if (!payload) {
      res.status(401).json({ error: "Phi\xEAn \u0111\u0103ng nh\u1EADp \u0111\xE3 h\u1EBFt h\u1EA1n ho\u1EB7c ch\u01B0a \u0111\u0103ng nh\u1EADp." });
      return;
    }
    const row = await getUserById(payload.uid);
    if (!row) {
      clearSessionCookie(req, res);
      res.status(401).json({ error: "T\xE0i kho\u1EA3n kh\xF4ng t\u1ED3n t\u1EA1i." });
      return;
    }
    if (row.is_locked) {
      clearSessionCookie(req, res);
      res.status(403).json({
        code: "ACCOUNT_LOCKED",
        error: "T\xE0i kho\u1EA3n n\xE0y \u0111\xE3 b\u1ECB kh\xF3a b\u1EDFi qu\u1EA3n tr\u1ECB vi\xEAn."
      });
      return;
    }
    const tokenSv = typeof payload.sv === "number" ? payload.sv : 1;
    const dbSv = Number(row.session_version ?? 1);
    if (tokenSv !== dbSv) {
      clearSessionCookie(req, res);
      res.status(401).json({ error: "Phi\xEAn \u0111\u0103ng nh\u1EADp \u0111\xE3 h\u1EBFt hi\u1EC7u l\u1EF1c do thay \u0111\u1ED5i b\u1EA3o m\u1EADt. Vui l\xF2ng \u0111\u0103ng nh\u1EADp l\u1EA1i." });
      return;
    }
    req.authUser = mapDbUserToAuthUser(row);
    next();
  } catch (err) {
    next(err);
  }
}
function requireAdmin(req, res, next) {
  if (!req.authUser || req.authUser.role !== "admin") {
    res.status(403).json({ error: "Ch\u1EC9 qu\u1EA3n tr\u1ECB vi\xEAn m\u1EDBi c\xF3 quy\u1EC1n th\u1EF1c hi\u1EC7n thao t\xE1c n\xE0y." });
    return;
  }
  next();
}

// server/cryptoVault.ts
import crypto3 from "node:crypto";
var ENC_PREFIX = "enc:v1:";
var EPHEMERAL_FALLBACK = crypto3.randomBytes(32).toString("hex");
function getVaultKey() {
  const configured = (process.env.DATA_ENCRYPTION_KEY || "").trim();
  if (configured && configured !== "CHANGE_ME_TO_A_32_BYTE_HEX_OR_RANDOM_STRING") {
    return crypto3.createHash("sha256").update(`vtk-vault:${configured}`).digest();
  }
  const sessionSecret = (process.env.SESSION_SECRET || "").trim();
  if (sessionSecret && sessionSecret !== "CHANGE_ME_TO_A_LONG_RANDOM_SECRET") {
    return crypto3.createHash("sha256").update(`vtk-vault-session:${sessionSecret}`).digest();
  }
  const tursoToken = (process.env.TURSO_AUTH_TOKEN || "").trim();
  if (tursoToken && tursoToken !== "YOUR_TURSO_AUTH_TOKEN") {
    return crypto3.createHash("sha256").update(`vtk-vault-turso:${tursoToken}`).digest();
  }
  return crypto3.createHash("sha256").update(`vtk-vault-ephemeral:${EPHEMERAL_FALLBACK}`).digest();
}
function encryptSecret(plaintext) {
  if (!plaintext) return "";
  const key = getVaultKey();
  const iv = crypto3.randomBytes(12);
  const cipher = crypto3.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${ENC_PREFIX}${iv.toString("base64url")}:${authTag.toString("base64url")}:${encrypted.toString("base64url")}`;
}
function isEncryptedSecret(value) {
  return typeof value === "string" && value.startsWith(ENC_PREFIX);
}
function decryptSecret(stored) {
  if (!stored) return null;
  if (!stored.startsWith(ENC_PREFIX)) {
    return stored;
  }
  const rest = stored.slice(ENC_PREFIX.length);
  const parts = rest.split(":");
  if (parts.length !== 3) return null;
  try {
    const iv = Buffer.from(parts[0], "base64url");
    const authTag = Buffer.from(parts[1], "base64url");
    const ciphertext = Buffer.from(parts[2], "base64url");
    if (iv.length !== 12 || authTag.length !== 16) return null;
    const key = getVaultKey();
    const decipher = crypto3.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString("utf8");
  } catch {
    return null;
  }
}

// server/db.ts
function getTursoConfig() {
  const rawUrl = (process.env.TURSO_DATABASE_URL || "").trim();
  const authToken = (process.env.TURSO_AUTH_TOKEN || "").trim();
  if (!rawUrl || !authToken) {
    throw new Error("Thi\u1EBFu c\u1EA5u h\xECnh TURSO_DATABASE_URL ho\u1EB7c TURSO_AUTH_TOKEN tr\xEAn m\xE1y ch\u1EE7.");
  }
  const httpUrl = rawUrl.replace(/^libsql:\/\//i, "https://").replace(/^wss:\/\//i, "https://").replace(/\/+$/, "");
  return { httpUrl, authToken };
}
function encodeArg(arg) {
  if (arg === null || arg === void 0) {
    return { type: "null" };
  }
  if (typeof arg === "boolean") {
    return { type: "integer", value: arg ? "1" : "0" };
  }
  if (typeof arg === "number") {
    if (!Number.isFinite(arg)) {
      return { type: "null" };
    }
    if (Number.isInteger(arg)) {
      return { type: "integer", value: String(arg) };
    }
    return { type: "float", value: String(arg) };
  }
  return { type: "text", value: String(arg) };
}
function decodeCell(cell) {
  if (!cell || cell.type === "null") return null;
  if (cell.type === "integer") {
    return cell.value !== void 0 ? Number.parseInt(cell.value, 10) : 0;
  }
  if (cell.type === "float") {
    return cell.value !== void 0 ? Number.parseFloat(cell.value) : 0;
  }
  return cell.value ?? "";
}
function mapResultRows(result) {
  const cols = result.cols.map((c) => c.name);
  return result.rows.map((row) => {
    const obj = {};
    for (let i = 0; i < cols.length; i++) {
      obj[cols[i]] = decodeCell(row[i]);
    }
    return obj;
  });
}
async function dbPipeline(statements) {
  const { httpUrl, authToken } = getTursoConfig();
  const requests = [
    ...statements.map((stmt) => ({
      type: "execute",
      stmt: {
        sql: stmt.sql,
        args: (stmt.args ?? []).map(encodeArg)
      }
    })),
    { type: "close" }
  ];
  const response = await fetch(`${httpUrl}/v2/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${authToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ requests })
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Turso HTTP ${response.status}: ${text || response.statusText}`);
  }
  const data = await response.json();
  const output = [];
  for (let i = 0; i < statements.length; i++) {
    const item = data.results[i];
    if (!item || item.type === "error") {
      throw new Error(item?.error?.message || `L\u1ED7i truy v\u1EA5n SQL t\u1EA1i l\u1EC7nh #${i + 1}`);
    }
    const result = item.response?.result;
    if (!result) {
      output.push({ rows: [], affectedRows: 0 });
    } else {
      output.push({
        rows: mapResultRows(result),
        affectedRows: result.affected_row_count ?? 0
      });
    }
  }
  return output;
}
async function dbQuery(sql, args = []) {
  const res = await dbPipeline([{ sql, args }]);
  return res[0].rows;
}
async function dbExecute(sql, args = []) {
  const res = await dbPipeline([{ sql, args }]);
  return { affectedRows: res[0].affectedRows };
}
async function initDatabase() {
  await dbPipeline([
    {
      sql: `CREATE TABLE IF NOT EXISTS app_users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        password_encrypted TEXT NOT NULL DEFAULT '',
        display_name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        is_root_admin INTEGER NOT NULL DEFAULT 0,
        is_locked INTEGER NOT NULL DEFAULT 0,
        must_change_password INTEGER NOT NULL DEFAULT 0,
        can_use_camera INTEGER NOT NULL DEFAULT 1,
        can_use_chat INTEGER NOT NULL DEFAULT 1,
        two_factor_enabled INTEGER NOT NULL DEFAULT 0,
        two_factor_secret TEXT NOT NULL DEFAULT '',
        two_factor_pending_secret TEXT NOT NULL DEFAULT '',
        session_version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS user_transactions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        amount INTEGER NOT NULL,
        denomination INTEGER,
        serial_number TEXT,
        serial_normalized TEXT,
        method TEXT NOT NULL DEFAULT 'manual',
        note TEXT NOT NULL DEFAULT '',
        ai_confidence REAL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`
    },
    {
      sql: `CREATE INDEX IF NOT EXISTS idx_tx_user_created ON user_transactions(user_id, created_at DESC)`
    },
    {
      sql: `CREATE INDEX IF NOT EXISTS idx_tx_serial_norm ON user_transactions(serial_normalized)`
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS user_goals (
        user_id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT 'M\u1EE5c ti\xEAu ti\u1EBFt ki\u1EC7m',
        target_amount INTEGER NOT NULL DEFAULT 10000000,
        updated_at TEXT NOT NULL
      )`
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS app_ai_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        provider TEXT NOT NULL DEFAULT 'server_default',
        api_key TEXT NOT NULL DEFAULT '',
        base_url TEXT NOT NULL DEFAULT '',
        chat_model TEXT NOT NULL DEFAULT 'gemini-4-hydrogen',
        vision_model TEXT NOT NULL DEFAULT 'auto',
        login_notice_enabled INTEGER NOT NULL DEFAULT 1,
        login_notice_tone TEXT NOT NULL DEFAULT 'emerald',
        login_notice_badge TEXT NOT NULL DEFAULT 'Th\xF4ng b\xE1o',
        login_notice_title TEXT NOT NULL DEFAULT '',
        login_notice_text TEXT NOT NULL DEFAULT 'Ch\xE0o m\u1EEBng b\u1EA1n \u0111\u1EBFn v\u1EDBi V\xED Ti\u1EBFt Ki\u1EC7m C\xE1 Nh\xE2n. \u0110\u0103ng nh\u1EADp \u0111\u1EC3 theo d\xF5i t\xEDch l\u0169y v\xE0 m\u1EE5c ti\xEAu t\xE0i ch\xEDnh c\u1EE7a b\u1EA1n.',
        login_discord_url TEXT NOT NULL DEFAULT '',
        login_discord_label TEXT NOT NULL DEFAULT 'Tham gia c\u1ED9ng \u0111\u1ED3ng Discord',
        login_social_links TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL
      )`
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS user_chat_messages (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`
    },
    {
      sql: `CREATE INDEX IF NOT EXISTS idx_chat_user_created ON user_chat_messages(user_id, created_at ASC)`
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS user_security_alerts (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL,
        intruder_user_id TEXT NOT NULL,
        intruder_username TEXT NOT NULL,
        serial_normalized TEXT NOT NULL,
        serial_display TEXT NOT NULL,
        amount INTEGER NOT NULL,
        source TEXT NOT NULL,
        is_read INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )`
    },
    {
      sql: `CREATE INDEX IF NOT EXISTS idx_alerts_owner ON user_security_alerts(owner_user_id, is_read, created_at DESC)`
    }
  ]);
  const [userCols, aiCols] = await Promise.all([
    dbQuery("PRAGMA table_info(app_users)"),
    dbQuery("PRAGMA table_info(app_ai_settings)")
  ]);
  const userColSet = new Set(userCols.map((c) => c.name));
  const aiColSet = new Set(aiCols.map((c) => c.name));
  const migrations = [];
  if (!userColSet.has("password_encrypted")) {
    migrations.push({ sql: `ALTER TABLE app_users ADD COLUMN password_encrypted TEXT NOT NULL DEFAULT ''` });
  }
  if (!userColSet.has("two_factor_enabled")) {
    migrations.push({ sql: `ALTER TABLE app_users ADD COLUMN two_factor_enabled INTEGER NOT NULL DEFAULT 0` });
  }
  if (!userColSet.has("two_factor_secret")) {
    migrations.push({ sql: `ALTER TABLE app_users ADD COLUMN two_factor_secret TEXT NOT NULL DEFAULT ''` });
  }
  if (!userColSet.has("two_factor_pending_secret")) {
    migrations.push({ sql: `ALTER TABLE app_users ADD COLUMN two_factor_pending_secret TEXT NOT NULL DEFAULT ''` });
  }
  if (!userColSet.has("session_version")) {
    migrations.push({ sql: `ALTER TABLE app_users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 1` });
  }
  if (!aiColSet.has("login_notice_enabled")) {
    migrations.push({ sql: `ALTER TABLE app_ai_settings ADD COLUMN login_notice_enabled INTEGER NOT NULL DEFAULT 1` });
  }
  if (!aiColSet.has("login_notice_tone")) {
    migrations.push({ sql: `ALTER TABLE app_ai_settings ADD COLUMN login_notice_tone TEXT NOT NULL DEFAULT 'emerald'` });
  }
  if (!aiColSet.has("login_notice_title")) {
    migrations.push({ sql: `ALTER TABLE app_ai_settings ADD COLUMN login_notice_title TEXT NOT NULL DEFAULT ''` });
  }
  if (!aiColSet.has("login_social_links")) {
    migrations.push({ sql: `ALTER TABLE app_ai_settings ADD COLUMN login_social_links TEXT NOT NULL DEFAULT '[]'` });
  }
  if (migrations.length > 0) {
    await dbPipeline(migrations);
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const existingAi = await dbQuery("SELECT id, login_discord_url, login_discord_label, login_social_links FROM app_ai_settings WHERE id = 1");
  if (existingAi.length === 0) {
    const customBase = (process.env.CUSTOM_AI_BASE_URL || "").trim();
    const customKey = (process.env.CUSTOM_AI_API_KEY || "").trim();
    const customChatModel = (process.env.CUSTOM_AI_CHAT_MODEL || "").trim();
    const customVisionModel = (process.env.CUSTOM_AI_VISION_MODEL || "").trim();
    const useCustom = Boolean(customBase && customKey && !customKey.startsWith("YOUR_"));
    const provider = useCustom ? "openai_compatible" : "server_default";
    const chatModel = useCustom ? customChatModel || "claude-opus-5" : "gemini-4-hydrogen";
    const visionModel = useCustom ? customVisionModel || "auto" : "auto";
    await dbExecute(
      `INSERT INTO app_ai_settings (
        id, provider, api_key, base_url, chat_model, vision_model,
        login_notice_enabled, login_notice_tone, login_notice_badge, login_notice_title, login_notice_text,
        login_discord_url, login_discord_label, login_social_links, updated_at
      ) VALUES (1, ?, ?, ?, ?, ?, 1, 'emerald', ?, ?, ?, '', ?, '[]', ?)`,
      [
        provider,
        useCustom ? encryptSecret(customKey) : "",
        useCustom ? customBase : "",
        chatModel,
        visionModel,
        "Th\xF4ng b\xE1o",
        "",
        "Ch\xE0o m\u1EEBng b\u1EA1n \u0111\u1EBFn v\u1EDBi V\xED Ti\u1EBFt Ki\u1EC7m C\xE1 Nh\xE2n. \u0110\u0103ng nh\u1EADp \u0111\u1EC3 theo d\xF5i t\xEDch l\u0169y v\xE0 m\u1EE5c ti\xEAu t\xE0i ch\xEDnh c\u1EE7a b\u1EA1n.",
        "Tham gia c\u1ED9ng \u0111\u1ED3ng Discord",
        now
      ]
    );
  } else {
    const row = existingAi[0];
    const hasLinksJson = row.login_social_links && row.login_social_links !== "[]";
    const legUrl = (row.login_discord_url || "").trim();
    if (!hasLinksJson && legUrl) {
      const migrated = JSON.stringify([
        {
          id: "legacy-discord",
          platform: "discord",
          label: (row.login_discord_label || "").trim() || "Tham gia c\u1ED9ng \u0111\u1ED3ng Discord",
          url: legUrl
        }
      ]);
      await dbExecute("UPDATE app_ai_settings SET login_social_links = ? WHERE id = 1", [migrated]);
    }
  }
  const envAdminPass = (process.env.ADMIN_INITIAL_PASSWORD || "").trim();
  const isPlaceholder = !envAdminPass || envAdminPass === "CHANGE_ME_INITIAL_ADMIN_PASSWORD";
  if (!isPlaceholder) {
    const existingAdmin = await dbQuery(
      "SELECT id FROM app_users WHERE is_root_admin = 1 OR username = 'admin' LIMIT 1"
    );
    if (existingAdmin.length === 0) {
      const passwordHash = await hashPassword(envAdminPass);
      const passwordEncrypted = encryptSecret(envAdminPass);
      const adminId = crypto.randomUUID();
      await dbPipeline([
        {
          sql: `INSERT INTO app_users (
            id, username, password_hash, password_encrypted, display_name, role, is_root_admin,
            is_locked, must_change_password, can_use_camera, can_use_chat, created_at, updated_at
          ) VALUES (?, 'admin', ?, ?, 'Qu\u1EA3n tr\u1ECB g\u1ED1c', 'admin', 1, 0, 1, 1, 1, ?, ?)`,
          args: [adminId, passwordHash, passwordEncrypted, now, now]
        },
        {
          sql: `INSERT INTO user_goals (user_id, title, target_amount, updated_at)
                VALUES (?, 'Qu\u1EF9 d\u1EF1 ph\xF2ng c\xE1 nh\xE2n', 10000000, ?)`,
          args: [adminId, now]
        }
      ]);
    }
  }
}

// server/ai.ts
import { GoogleGenAI, Type } from "@google/genai";
import net from "node:net";

// src/utils/currency.ts
var VND_DENOMINATIONS = [
  5e5,
  2e5,
  1e5,
  5e4,
  2e4,
  1e4,
  5e3,
  2e3,
  1e3
];
function formatVnd(amount) {
  const safe = Number.isFinite(amount) ? Math.trunc(amount) : 0;
  const isNegative = safe < 0;
  const abs = Math.abs(safe);
  const formatted = abs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${isNegative ? "-" : ""}${formatted} \u20AB`;
}

// src/utils/serial.ts
function normalizeSerial(raw) {
  if (!raw) return "";
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// server/ai.ts
async function getAiSettings() {
  const rows = await dbQuery("SELECT * FROM app_ai_settings WHERE id = 1 LIMIT 1");
  if (rows[0]) {
    const row = rows[0];
    const rawKey = (row.api_key || "").trim();
    const decryptedKey = rawKey ? isEncryptedSecret(rawKey) ? decryptSecret(rawKey) ?? "" : rawKey : "";
    return {
      ...row,
      api_key: decryptedKey
    };
  }
  return {
    id: 1,
    provider: "server_default",
    api_key: "",
    base_url: "",
    chat_model: "gemini-4-hydrogen",
    vision_model: "auto",
    login_notice_enabled: 1,
    login_notice_tone: "emerald",
    login_notice_badge: "Th\xF4ng b\xE1o",
    login_notice_title: "",
    login_notice_text: "",
    login_discord_url: "",
    login_discord_label: "Tham gia c\u1ED9ng \u0111\u1ED3ng Discord",
    login_social_links: "[]",
    updated_at: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function isPrivateIp(host) {
  const ipType = net.isIP(host);
  if (ipType === 4) {
    const parts = host.split(".").map(Number);
    if (parts[0] === 10) return true;
    if (parts[0] === 127) return true;
    if (parts[0] === 0) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    return false;
  }
  if (ipType === 6) {
    const lower = host.toLowerCase();
    return lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80");
  }
  return false;
}
function assertSafeExternalUrl(rawUrl) {
  const trimmed = rawUrl.trim().replace(/\/+$/, "");
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Base URL kh\xF4ng \u0111\xFAng \u0111\u1ECBnh d\u1EA1ng URL.");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Base URL ch\u1EC9 ch\u1EA5p nh\u1EADn giao th\u1EE9c http ho\u1EB7c https.");
  }
  const hostname = parsed.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".local") || hostname.endsWith(".internal") || isPrivateIp(hostname)) {
    throw new Error("Base URL kh\xF4ng \u0111\u01B0\u1EE3c tr\u1ECF t\u1EDBi \u0111\u1ECBa ch\u1EC9 n\u1ED9i b\u1ED9 ho\u1EB7c loopback.");
  }
  return trimmed;
}
var RetryableAiError = class extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
};
async function withRetry(fn, maxRetries = 2) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      const status = err instanceof RetryableAiError ? err.status : /503|overloaded|unavailable|429|resource_exhausted/i.test(msg) ? 503 : 0;
      if (attempt < maxRetries && (status === 503 || status === 429)) {
        const delayMs = 600 * (attempt + 1);
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}
function getGeminiClient(apiKey) {
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build"
      }
    }
  });
}
function resolveVisionModelCandidates(provider, settings) {
  const configured = (settings.vision_model || "").trim();
  if (configured && configured.toLowerCase() !== "auto") {
    return [configured];
  }
  if (provider === "server_default" || provider === "gemini") {
    return ["gemini-4-hydrogen", "gemini-4-neon"];
  }
  if (provider === "anthropic") {
    const primary = settings.chat_model && settings.chat_model.includes("claude") ? settings.chat_model : "claude-opus-5";
    return [primary];
  }
  if (provider === "openai") {
    return ["gpt-4o", "gpt-4o-mini"];
  }
  const chat = (settings.chat_model || "").trim();
  if (chat) return [chat];
  return ["claude-opus-5"];
}
function resolveChatModel(provider, settings) {
  const configured = (settings.chat_model || "").trim();
  if (configured) return configured;
  if (provider === "server_default" || provider === "gemini") return "gemini-4-hydrogen";
  if (provider === "anthropic") return "claude-opus-5";
  if (provider === "openai") return "gpt-4o-mini";
  return "claude-opus-5";
}
function parseDataUrl(imageDataUrl) {
  const match = /^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=\s]+)$/i.exec(
    imageDataUrl.trim()
  );
  if (!match) {
    throw new Error("\u0110\u1ECBnh d\u1EA1ng \u1EA3nh kh\xF4ng h\u1EE3p l\u1EC7 (h\u1ED7 tr\u1EE3 PNG, JPEG, WebP).");
  }
  const mimeType = match[1].toLowerCase() === "image/jpg" ? "image/jpeg" : match[1].toLowerCase();
  const base64 = match[2].replace(/\s+/g, "");
  if (base64.length > 7e6) {
    throw new Error("\u1EA2nh qu\xE1 l\u1EDBn. Vui l\xF2ng ch\u1ECDn \u1EA3nh d\u01B0\u1EDBi 5MB.");
  }
  return { mimeType, base64 };
}
function extractJsonObject(rawText) {
  const trimmed = rawText.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");
  const jsonStr = firstBrace >= 0 && lastBrace > firstBrace ? candidate.slice(firstBrace, lastBrace + 1) : candidate;
  try {
    const parsed = JSON.parse(jsonStr);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("D\u1EEF li\u1EC7u JSON kh\xF4ng h\u1EE3p l\u1EC7.");
    }
    return parsed;
  } catch {
    throw new Error("AI tr\u1EA3 v\u1EC1 d\u1EEF li\u1EC7u kh\xF4ng \u0111\xFAng \u0111\u1ECBnh d\u1EA1ng JSON. Vui l\xF2ng ch\u1EE5p \u1EA3nh r\xF5 n\xE9t h\u01A1n ho\u1EB7c th\u1EED l\u1EA1i.");
  }
}
function normalizeScanOutput(parsed) {
  const rawDenom = typeof parsed.denomination === "number" ? Math.trunc(parsed.denomination) : null;
  const validDenom = rawDenom && VND_DENOMINATIONS.includes(rawDenom) ? rawDenom : null;
  const rawSerial = typeof parsed.serialNumber === "string" && parsed.serialNumber.trim().length > 0 ? parsed.serialNumber.trim().slice(0, 40) : null;
  const serialNormalized = rawSerial ? normalizeSerial(rawSerial) || null : null;
  let confidence = 0;
  if (typeof parsed.confidence === "number" && Number.isFinite(parsed.confidence)) {
    confidence = Math.min(1, Math.max(0, parsed.confidence));
  }
  const note = typeof parsed.note === "string" && parsed.note.trim().length > 0 ? parsed.note.trim().slice(0, 200) : validDenom ? `Nh\u1EADn di\u1EC7n t\u1EDD ${validDenom.toLocaleString("vi-VN")} \u20AB` : "Kh\xF4ng nh\u1EADn di\u1EC7n r\xF5 m\u1EC7nh gi\xE1 t\u1EDD ti\u1EC1n VN\u0110 trong \u1EA3nh.";
  return {
    denomination: validDenom,
    serialNumber: rawSerial,
    serialNormalized,
    confidence,
    note
  };
}
async function scanBillWithAi(settings, imageDataUrl) {
  const { mimeType, base64 } = parseDataUrl(imageDataUrl);
  const provider = settings.provider || "server_default";
  const modelCandidates = resolveVisionModelCandidates(provider, settings);
  const systemPrompt = 'B\u1EA1n l\xE0 h\u1EC7 th\u1ED1ng OCR ti\u1EC1n gi\u1EA5y/polymer Vi\u1EC7t Nam (VN\u0110). H\xE3y quan s\xE1t \u1EA3nh v\xE0 tr\xEDch xu\u1EA5t ch\xEDnh x\xE1c:\n1. denomination: s\u1ED1 nguy\xEAn m\u1EC7nh gi\xE1 VN\u0110 thu\u1ED9c [500000, 200000, 100000, 50000, 20000, 10000, 5000, 2000, 1000] ho\u1EB7c null n\u1EBFu kh\xF4ng ph\u1EA3i t\u1EDD ti\u1EC1n VN\u0110.\n2. serialNumber: chu\u1ED7i s\u1ED1 seri in tr\xEAn t\u1EDD ti\u1EC1n (v\xED d\u1EE5 "AB 12345678"), ho\u1EB7c null n\u1EBFu b\u1ECB che/m\u1EDD kh\xF4ng \u0111\u1ECDc \u0111\u01B0\u1EE3c.\n3. confidence: \u0111\u1ED9 tin c\u1EADy t\u1EEB 0 \u0111\u1EBFn 1.\n4. note: ghi ch\xFA ng\u1EAFn b\u1EB1ng ti\u1EBFng Vi\u1EC7t.\nCh\u1EC9 tr\u1EA3 v\u1EC1 JSON thu\u1EA7n t\xFAy v\u1EDBi c\xE1c kh\xF3a denomination, serialNumber, confidence, note.';
  const scanWithModel = (model) => withRetry(async () => {
    if (provider === "server_default" || provider === "gemini") {
      const apiKey2 = provider === "gemini" ? (settings.api_key || "").trim() || (process.env.GEMINI_API_KEY || "").trim() : (process.env.GEMINI_API_KEY || "").trim();
      if (!apiKey2) {
        throw new Error("Ch\u01B0a c\u1EA5u h\xECnh GEMINI_API_KEY tr\xEAn m\xE1y ch\u1EE7.");
      }
      const ai = getGeminiClient(apiKey2);
      const response = await ai.models.generateContent({
        model,
        contents: {
          parts: [
            { inlineData: { mimeType, data: base64 } },
            { text: "H\xE3y nh\u1EADn di\u1EC7n m\u1EC7nh gi\xE1 v\xE0 s\u1ED1 seri t\u1EDD ti\u1EC1n VN\u0110 trong \u1EA3nh n\xE0y." }
          ]
        },
        config: {
          systemInstruction: systemPrompt,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              denomination: { type: Type.INTEGER, nullable: true },
              serialNumber: { type: Type.STRING, nullable: true },
              confidence: { type: Type.NUMBER },
              note: { type: Type.STRING }
            }
          }
        }
      });
      const parsed = extractJsonObject(response.text || "{}");
      return normalizeScanOutput(parsed);
    }
    if (provider === "anthropic") {
      const apiKey2 = (settings.api_key || "").trim();
      if (!apiKey2) throw new Error("Ch\u01B0a c\u1EA5u h\xECnh API Key cho Anthropic.");
      const baseUrl2 = settings.base_url ? assertSafeExternalUrl(settings.base_url) : "https://api.anthropic.com/v1";
      const res2 = await fetch(`${baseUrl2}/messages`, {
        method: "POST",
        headers: {
          "x-api-key": apiKey2,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model,
          max_tokens: 400,
          system: systemPrompt,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image",
                  source: { type: "base64", media_type: mimeType, data: base64 }
                },
                { type: "text", text: "Tr\xEDch xu\u1EA5t JSON m\u1EC7nh gi\xE1 v\xE0 s\u1ED1 seri t\u1EDD ti\u1EC1n VN\u0110." }
              ]
            }
          ]
        }),
        signal: AbortSignal.timeout(25e3)
      });
      if (res2.status === 503 || res2.status === 429) {
        throw new RetryableAiError(`D\u1ECBch v\u1EE5 AI \u0111ang qu\xE1 t\u1EA3i (${res2.status}).`, res2.status);
      }
      if (!res2.ok) {
        const errBody = await res2.text().catch(() => "");
        throw new Error(`L\u1ED7i Anthropic (${res2.status}): ${errBody.slice(0, 200)}`);
      }
      const data2 = await res2.json();
      const text2 = data2.content?.find((c) => c.type === "text")?.text || "{}";
      return normalizeScanOutput(extractJsonObject(text2));
    }
    const apiKey = (settings.api_key || "").trim();
    if (!apiKey) throw new Error("Ch\u01B0a c\u1EA5u h\xECnh API Key cho nh\xE0 cung c\u1EA5p AI.");
    const baseUrl = provider === "openai" ? "https://api.openai.com/v1" : assertSafeExternalUrl(settings.base_url || "");
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_tokens: 400,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              { type: "text", text: "H\xE3y tr\xEDch xu\u1EA5t JSON m\u1EC7nh gi\xE1 v\xE0 s\u1ED1 seri t\u1EDD ti\u1EC1n VN\u0110 trong \u1EA3nh." },
              { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } }
            ]
          }
        ]
      }),
      signal: AbortSignal.timeout(25e3)
    });
    if (res.status === 503 || res.status === 429) {
      throw new RetryableAiError(`D\u1ECBch v\u1EE5 AI \u0111ang qu\xE1 t\u1EA3i (${res.status}).`, res.status);
    }
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(`L\u1ED7i AI (${res.status}): ${errBody.slice(0, 220)}`);
    }
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || "{}";
    return normalizeScanOutput(extractJsonObject(text));
  });
  let lastErr;
  for (const model of modelCandidates) {
    try {
      return await scanWithModel(model);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Kh\xF4ng th\u1EC3 ph\xE2n t\xEDch \u1EA3nh t\u1EDD ti\u1EC1n l\xFAc n\xE0y.");
}
async function advisorChatWithAi(settings, financialContext, history, userMessage) {
  const provider = settings.provider || "server_default";
  const model = resolveChatModel(provider, settings);
  const systemInstruction = `B\u1EA1n l\xE0 Tr\u1EE3 l\xFD T\xE0i ch\xEDnh C\xE1 nh\xE2n th\xF4ng minh v\xE0 tinh t\u1EBF cho \u1EE9ng d\u1EE5ng "V\xED Ti\u1EBFt Ki\u1EC7m C\xE1 Nh\xE2n" (ti\u1EC1n t\u1EC7 VN\u0110).
QUY T\u1EAEC B\u1EAET BU\u1ED8C:
1. Ch\u1EC9 tr\u1EA3 l\u1EDDi c\xE1c ch\u1EE7 \u0111\u1EC1 li\xEAn quan \u0111\u1EBFn qu\u1EA3n l\xFD t\xE0i ch\xEDnh c\xE1 nh\xE2n, ti\u1EBFt ki\u1EC7m, l\u1EADp ng\xE2n s\xE1ch, m\u1EE5c ti\xEAu t\xEDch l\u0169y b\u1EB1ng VN\u0110 v\xE0 ph\xE2n t\xEDch s\u1ED1 li\u1EC7u v\xED c\u1EE7a ng\u01B0\u1EDDi d\xF9ng.
2. N\u1EBFu ng\u01B0\u1EDDi d\xF9ng h\u1ECFi ngo\xE0i ph\u1EA1m vi t\xE0i ch\xEDnh c\xE1 nh\xE2n (l\u1EADp tr\xECnh, ch\xEDnh tr\u1ECB, gi\u1EA3i tr\xED, vi\u1EBFt code...), h\xE3y l\u1ECBch s\u1EF1 t\u1EEB ch\u1ED1i v\xE0 h\u01B0\u1EDBng h\u1ECD quay l\u1EA1i c\xE2u chuy\u1EC7n ti\u1EBFt ki\u1EC7m VN\u0110.
3. Tr\u1EA3 l\u1EDDi b\u1EB1ng ti\u1EBFng Vi\u1EC7t t\u1EF1 nhi\xEAn, m\u1EA1ch l\u1EA1c, th\xE2n thi\u1EC7n nh\u01B0 m\u1ED9t c\u1ED1 v\u1EA5n t\xE0i ch\xEDnh th\u1EF1c th\u1EE5 (kh\xF4ng qu\xE1 th\xF4 s\u01A1 hay c\u1EE9ng nh\u1EAFc), c\xF3 s\u1ED1 li\u1EC7u c\u1EE5 th\u1EC3 d\u1EF1a tr\xEAn d\u1EEF li\u1EC7u v\xED hi\u1EC7n t\u1EA1i (kh\xF4ng b\u1ECBa \u0111\u1EB7t s\u1ED1 li\u1EC7u).
4. \u0110\u1ECANH D\u1EA0NG V\u0102N B\u1EA2N:
   - Tr\xF2 chuy\u1EC7n b\xECnh th\u01B0\u1EDDng b\u1EB1ng c\xE1c \u0111o\u1EA1n v\u0103n r\xF5 r\xE0ng, xu\u1ED1ng d\xF2ng tho\xE1ng; kh\xF4ng d\xF9ng k\xFD t\u1EF1 d\u1EA5u th\u0103ng (#) l\xE0m ti\xEAu \u0111\u1EC1, kh\xF4ng r\u1EA3i d\u1EA5u sao (*) b\u1EEBa b\xE3i trong c\xE2u, d\xF9ng d\u1EA5u g\u1EA1ch \u0111\u1EA7u d\xF2ng (-) ho\u1EB7c s\u1ED1 th\u1EE9 t\u1EF1 (1., 2.) khi c\u1EA7n li\u1EC7t k\xEA, v\xE0 d\xF9ng d\u1EA5u "\xD7" cho ph\xE9p nh\xE2n thay v\xEC "*".
   - Khi c\u1EA7n tr\xECnh b\xE0y b\u1EA3ng k\u1EBF ho\u1EA1ch ti\u1EBFt ki\u1EC7m, b\u1EA3ng ph\xE2n b\u1ED5 ng\xE2n s\xE1ch, b\u1EA3ng so s\xE1nh ph\u01B0\u01A1ng \xE1n ho\u1EB7c l\u1ECBch t\xEDch l\u0169y nhi\u1EC1u m\u1ED1c s\u1ED1 li\u1EC7u, h\xE3y k\u1EBB b\u1EA3ng Markdown chu\u1EA9n (v\xED d\u1EE5: | H\u1EA1ng m\u1EE5c | S\u1ED1 ti\u1EC1n (VN\u0110) | Ghi ch\xFA | k\xE8m d\xF2ng ph\xE2n c\xE1ch |---|---:|---|) \u0111\u1EC3 giao di\u1EC7n hi\u1EC3n th\u1ECB th\xE0nh b\u1EA3ng k\u1EBB \xF4 r\xF5 r\xE0ng.

D\u1EEE LI\u1EC6U V\xCD HI\u1EC6N T\u1EA0I C\u1EE6A NG\u01AF\u1EDCI D\xD9NG:
${financialContext}`;
  return withRetry(async () => {
    if (provider === "server_default" || provider === "gemini") {
      const apiKey2 = provider === "gemini" ? (settings.api_key || "").trim() || (process.env.GEMINI_API_KEY || "").trim() : (process.env.GEMINI_API_KEY || "").trim();
      if (!apiKey2) {
        throw new Error("Ch\u01B0a c\u1EA5u h\xECnh GEMINI_API_KEY tr\xEAn m\xE1y ch\u1EE7.");
      }
      const ai = getGeminiClient(apiKey2);
      const contents = [
        ...history.slice(-10).map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }]
        })),
        { role: "user", parts: [{ text: userMessage }] }
      ];
      const response = await ai.models.generateContent({
        model,
        contents,
        config: { systemInstruction }
      });
      return (response.text || "").trim() || "Xin l\u1ED7i, t\xF4i ch\u01B0a th\u1EC3 t\u1EA1o ph\u1EA3n h\u1ED3i l\xFAc n\xE0y.";
    }
    if (provider === "anthropic") {
      const apiKey2 = (settings.api_key || "").trim();
      if (!apiKey2) throw new Error("Ch\u01B0a c\u1EA5u h\xECnh API Key cho Anthropic.");
      const baseUrl2 = settings.base_url ? assertSafeExternalUrl(settings.base_url) : "https://api.anthropic.com/v1";
      const res2 = await fetch(`${baseUrl2}/messages`, {
        method: "POST",
        headers: {
          "x-api-key": apiKey2,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model,
          max_tokens: 900,
          system: systemInstruction,
          messages: [
            ...history.slice(-10).map((m) => ({ role: m.role, content: m.content })),
            { role: "user", content: userMessage }
          ]
        }),
        signal: AbortSignal.timeout(25e3)
      });
      if (res2.status === 503 || res2.status === 429) {
        throw new RetryableAiError(`D\u1ECBch v\u1EE5 AI \u0111ang qu\xE1 t\u1EA3i (${res2.status}).`, res2.status);
      }
      if (!res2.ok) {
        const errBody = await res2.text().catch(() => "");
        throw new Error(`L\u1ED7i Anthropic (${res2.status}): ${errBody.slice(0, 200)}`);
      }
      const data2 = await res2.json();
      return data2.content?.find((c) => c.type === "text")?.text?.trim() || "Kh\xF4ng c\xF3 ph\u1EA3n h\u1ED3i.";
    }
    const apiKey = (settings.api_key || "").trim();
    if (!apiKey) throw new Error("Ch\u01B0a c\u1EA5u h\xECnh API Key cho nh\xE0 cung c\u1EA5p AI.");
    const baseUrl = provider === "openai" ? "https://api.openai.com/v1" : assertSafeExternalUrl(settings.base_url || "");
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        max_tokens: 900,
        messages: [
          { role: "system", content: systemInstruction },
          ...history.slice(-10).map((m) => ({ role: m.role, content: m.content })),
          { role: "user", content: userMessage }
        ]
      }),
      signal: AbortSignal.timeout(25e3)
    });
    if (res.status === 503 || res.status === 429) {
      throw new RetryableAiError(`D\u1ECBch v\u1EE5 AI \u0111ang qu\xE1 t\u1EA3i (${res.status}).`, res.status);
    }
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(`L\u1ED7i AI (${res.status}): ${errBody.slice(0, 220)}`);
    }
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || "Kh\xF4ng c\xF3 ph\u1EA3n h\u1ED3i.";
  });
}
async function listProviderModels(params) {
  const { provider } = params;
  if (provider === "server_default" || provider === "gemini") {
    return [
      "gemini-4-hydrogen",
      "gemini-4-neon",
      "gemini-4-carbon",
      "gemini-4-argon",
      "gemini-3.1-flash-lite"
    ];
  }
  const key = (params.apiKey || "").trim();
  if (!key) {
    throw new Error("C\u1EA7n c\xF3 API Key \u0111\u1EC3 l\u1EA5y danh s\xE1ch model t\u1EEB nh\xE0 cung c\u1EA5p.");
  }
  if (provider === "anthropic") {
    const base2 = params.baseUrl ? assertSafeExternalUrl(params.baseUrl) : "https://api.anthropic.com/v1";
    const res2 = await fetch(`${base2}/models`, {
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01"
      },
      signal: AbortSignal.timeout(1e4)
    });
    if (!res2.ok) {
      throw new Error(`Kh\xF4ng th\u1EC3 t\u1EA3i danh s\xE1ch model Anthropic (HTTP ${res2.status}).`);
    }
    const data2 = await res2.json();
    return (data2.data ?? []).map((m) => m.id).filter(Boolean);
  }
  const base = provider === "openai" ? "https://api.openai.com/v1" : assertSafeExternalUrl(params.baseUrl || "");
  const res = await fetch(`${base}/models`, {
    headers: {
      Authorization: `Bearer ${key}`
    },
    signal: AbortSignal.timeout(1e4)
  });
  if (!res.ok) {
    throw new Error(`Kh\xF4ng th\u1EC3 t\u1EA3i danh s\xE1ch model (HTTP ${res.status}).`);
  }
  const data = await res.json();
  return (data.data ?? []).map((m) => m.id).filter(Boolean);
}
async function testAiConnection(settings) {
  const started = Date.now();
  const provider = settings.provider || "server_default";
  const model = resolveChatModel(provider, settings);
  const reply = await advisorChatWithAi(
    settings,
    "- Ki\u1EC3m tra k\u1EBFt n\u1ED1i AI t\u1EEB trang Qu\u1EA3n tr\u1ECB (s\u1ED1 d\u01B0 m\u1EABu: 1.000.000 \u20AB).",
    [],
    "H\xE3y tr\u1EA3 l\u1EDDi \u0111\xFAng m\u1ED9t c\xE2u ng\u1EAFn b\u1EB1ng ti\u1EBFng Vi\u1EC7t x\xE1c nh\u1EADn k\u1EBFt n\u1ED1i AI ho\u1EA1t \u0111\u1ED9ng b\xECnh th\u01B0\u1EDDng."
  );
  return {
    ok: true,
    model,
    reply,
    latencyMs: Math.max(1, Date.now() - started)
  };
}

// server/rateLimit.ts
var DEFAULT_MAX_ATTEMPTS = 8;
var DEFAULT_WINDOW_MS = 5 * 60 * 1e3;
var AuthRateLimiter = class {
  constructor(maxAttempts = DEFAULT_MAX_ATTEMPTS, windowMs = DEFAULT_WINDOW_MS) {
    this.store = /* @__PURE__ */ new Map();
    this.maxAttempts = maxAttempts;
    this.windowMs = windowMs;
  }
  prune(key, nowMs) {
    const entry = this.store.get(key);
    if (!entry) return [];
    const cutoff = nowMs - this.windowMs;
    const recent = entry.timestamps.filter((t) => t > cutoff);
    if (recent.length === 0) {
      this.store.delete(key);
      return [];
    }
    entry.timestamps = recent;
    return recent;
  }
  check(key, nowMs = Date.now()) {
    const recent = this.prune(key, nowMs);
    if (recent.length < this.maxAttempts) {
      return { allowed: true, retryAfterSeconds: 0 };
    }
    const oldest = recent[0];
    const retryAfterSeconds = Math.max(1, Math.ceil((oldest + this.windowMs - nowMs) / 1e3));
    return { allowed: false, retryAfterSeconds };
  }
  recordFailure(key, nowMs = Date.now()) {
    const recent = this.prune(key, nowMs);
    recent.push(nowMs);
    this.store.set(key, { timestamps: recent });
  }
  clear(key) {
    this.store.delete(key);
  }
};
var authRateLimiter = new AuthRateLimiter();

// server/adminPolicy.ts
function checkAdminSelfAction(params) {
  if (params.actorId !== params.targetId) {
    return { allowed: true, status: 200 };
  }
  if (params.action === "delete") {
    return { allowed: false, status: 400, error: "Kh\xF4ng th\u1EC3 t\u1EF1 x\xF3a t\xE0i kho\u1EA3n \u0111ang \u0111\u0103ng nh\u1EADp." };
  }
  if (params.action === "lock") {
    return { allowed: false, status: 400, error: "Kh\xF4ng th\u1EC3 t\u1EF1 kh\xF3a t\xE0i kho\u1EA3n c\u1EE7a ch\xEDnh m\xECnh." };
  }
  return { allowed: false, status: 400, error: "Kh\xF4ng th\u1EC3 t\u1EF1 h\u1EA1 quy\u1EC1n qu\u1EA3n tr\u1ECB c\u1EE7a ch\xEDnh m\xECnh." };
}
function requiresOldPasswordForAdminReset(actorId, targetId) {
  return actorId === targetId;
}
function canInspectUserCredentials(actor, target) {
  if (target.isRootAdmin && !actor.isRootAdmin) {
    return {
      allowed: false,
      status: 403,
      error: "Admin ph\u1EE5 kh\xF4ng th\u1EC3 xem th\xF4ng tin b\u1EA3o m\u1EADt c\u1EE7a Qu\u1EA3n tr\u1ECB g\u1ED1c."
    };
  }
  if (!actor.isRootAdmin && target.role === "admin" && target.id !== actor.id) {
    return {
      allowed: false,
      status: 403,
      error: "Admin ph\u1EE5 kh\xF4ng th\u1EC3 xem th\xF4ng tin b\u1EA3o m\u1EADt c\u1EE7a qu\u1EA3n tr\u1ECB vi\xEAn kh\xE1c."
    };
  }
  return { allowed: true, status: 200 };
}

// server/totp.ts
import crypto4 from "node:crypto";
import QRCode from "qrcode";
var BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = "";
  for (let i = 0; i < buffer.length; i++) {
    value = value << 8 | buffer[i];
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[value >>> bits - 5 & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[value << 5 - bits & 31];
  }
  return output;
}
function base32Decode(input) {
  const cleaned = input.toUpperCase().replace(/[\s=-]+/g, "");
  if (!cleaned) return Buffer.alloc(0);
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (let i = 0; i < cleaned.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(cleaned[i]);
    if (idx === -1) {
      throw new Error("M\xE3 kh\xF3a b\xED m\u1EADt Base32 kh\xF4ng h\u1EE3p l\u1EC7.");
    }
    value = value << 5 | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push(value >>> bits - 8 & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}
function generateBase32Secret(byteLength = 20) {
  return base32Encode(crypto4.randomBytes(byteLength));
}
function generateTotpCode(secretBase32, timestampMs = Date.now(), stepSeconds = 30, digits = 6) {
  const key = base32Decode(secretBase32);
  if (key.length === 0) {
    throw new Error("Secret Base32 tr\u1ED1ng.");
  }
  const counter = Math.floor(timestampMs / 1e3 / stepSeconds);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto4.createHmac("sha1", key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 15;
  const binary = (hmac[offset] & 127) << 24 | (hmac[offset + 1] & 255) << 16 | (hmac[offset + 2] & 255) << 8 | hmac[offset + 3] & 255;
  const otp = binary % 10 ** digits;
  return String(otp).padStart(digits, "0");
}
function verifyTotpCode(secretBase32, inputCode, timestampMs = Date.now(), window = 1, stepSeconds = 30) {
  const normalized = inputCode.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(normalized)) {
    return false;
  }
  const inputBuf = Buffer.from(normalized, "utf8");
  let matched = false;
  for (let delta = -window; delta <= window; delta++) {
    const candidate = generateTotpCode(
      secretBase32,
      timestampMs + delta * stepSeconds * 1e3,
      stepSeconds,
      6
    );
    const candidateBuf = Buffer.from(candidate, "utf8");
    if (candidateBuf.length === inputBuf.length && crypto4.timingSafeEqual(candidateBuf, inputBuf)) {
      matched = true;
    }
  }
  return matched;
}
function buildOtpAuthUri(params) {
  const issuer = params.issuer.trim();
  const account = params.accountName.trim();
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const qs = new URLSearchParams({
    secret: params.secret,
    issuer,
    algorithm: "SHA1",
    digits: "6",
    period: "30"
  });
  return `otpauth://totp/${label}?${qs.toString()}`;
}
async function generateQrDataUrl(otpauthUri) {
  return QRCode.toDataURL(otpauthUri, {
    width: 240,
    margin: 2,
    color: {
      dark: "#0f172a",
      light: "#ffffff"
    }
  });
}

// src/utils/cashflow.ts
function toLocalDayKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function toLocalMonthKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}
function parseTxDate(iso) {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? /* @__PURE__ */ new Date() : parsed;
}
function computeCashflowSummary(transactions, now = /* @__PURE__ */ new Date(), daysCount = 14, monthsCount = 6) {
  const todayKey = toLocalDayKey(now);
  const monthKey = toLocalMonthKey(now);
  let totalDeposits = 0;
  let totalWithdrawals = 0;
  let todayDeposits = 0;
  let todayWithdrawals = 0;
  let monthDeposits = 0;
  let monthWithdrawals = 0;
  const dailyBuckets = /* @__PURE__ */ new Map();
  const monthlyBuckets = /* @__PURE__ */ new Map();
  const denomMap = /* @__PURE__ */ new Map();
  for (const denom of VND_DENOMINATIONS) {
    denomMap.set(denom, { depCount: 0, wdCount: 0, totalAmount: 0 });
  }
  const sorted = [...transactions].sort(
    (a, b) => parseTxDate(a.createdAt).getTime() - parseTxDate(b.createdAt).getTime()
  );
  for (const tx of sorted) {
    const amount = Math.max(0, Math.trunc(tx.amount));
    const dt = parseTxDate(tx.createdAt);
    const dKey = toLocalDayKey(dt);
    const mKey = toLocalMonthKey(dt);
    const dBucket = dailyBuckets.get(dKey) ?? { dep: 0, wd: 0 };
    const mBucket = monthlyBuckets.get(mKey) ?? { dep: 0, wd: 0 };
    if (tx.type === "deposit") {
      totalDeposits += amount;
      dBucket.dep += amount;
      mBucket.dep += amount;
      if (dKey === todayKey) todayDeposits += amount;
      if (mKey === monthKey) monthDeposits += amount;
    } else {
      totalWithdrawals += amount;
      dBucket.wd += amount;
      mBucket.wd += amount;
      if (dKey === todayKey) todayWithdrawals += amount;
      if (mKey === monthKey) monthWithdrawals += amount;
    }
    dailyBuckets.set(dKey, dBucket);
    monthlyBuckets.set(mKey, mBucket);
    if (tx.denomination && denomMap.has(tx.denomination)) {
      const entry = denomMap.get(tx.denomination);
      if (tx.type === "deposit") {
        entry.depCount += 1;
        entry.totalAmount += tx.denomination;
      } else {
        entry.wdCount += 1;
        entry.totalAmount -= tx.denomination;
      }
    }
  }
  const dailyKeys = [];
  for (let i = daysCount - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const key = toLocalDayKey(d);
    const label = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
    dailyKeys.push({ key, label });
  }
  const firstDayKey = dailyKeys[0]?.key ?? todayKey;
  let baselineBeforeDaily = 0;
  for (const [k, b] of dailyBuckets.entries()) {
    if (k < firstDayKey) {
      baselineBeforeDaily += b.dep - b.wd;
    }
  }
  let runningDaily = baselineBeforeDaily;
  const dailySeries = dailyKeys.map(({ key, label }) => {
    const b = dailyBuckets.get(key) ?? { dep: 0, wd: 0 };
    const netChange = b.dep - b.wd;
    runningDaily += netChange;
    const barAmount = Math.abs(b.dep > 0 ? b.dep : netChange);
    return {
      key,
      label,
      depositAmount: b.dep,
      withdrawAmount: b.wd,
      barAmount,
      netChange,
      cumulativeBalance: runningDaily
    };
  });
  const monthlyKeys = [];
  for (let i = monthsCount - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = toLocalMonthKey(d);
    const label = `T${d.getMonth() + 1}/${String(d.getFullYear()).slice(-2)}`;
    monthlyKeys.push({ key, label });
  }
  const firstMonthKey = monthlyKeys[0]?.key ?? monthKey;
  let baselineBeforeMonthly = 0;
  for (const [k, b] of monthlyBuckets.entries()) {
    if (k < firstMonthKey) {
      baselineBeforeMonthly += b.dep - b.wd;
    }
  }
  let runningMonthly = baselineBeforeMonthly;
  const monthlySeries = monthlyKeys.map(({ key, label }) => {
    const b = monthlyBuckets.get(key) ?? { dep: 0, wd: 0 };
    const netChange = b.dep - b.wd;
    runningMonthly += netChange;
    const barAmount = Math.abs(b.dep > 0 ? b.dep : netChange);
    return {
      key,
      label,
      depositAmount: b.dep,
      withdrawAmount: b.wd,
      barAmount,
      netChange,
      cumulativeBalance: runningMonthly
    };
  });
  const denominationBreakdown = [];
  for (const denom of VND_DENOMINATIONS) {
    const entry = denomMap.get(denom);
    if (entry.depCount > 0 || entry.wdCount > 0) {
      denominationBreakdown.push({
        denomination: denom,
        depositCount: entry.depCount,
        withdrawCount: entry.wdCount,
        netCount: entry.depCount - entry.wdCount,
        totalAmount: entry.totalAmount
      });
    }
  }
  return {
    netBalance: totalDeposits - totalWithdrawals,
    totalDeposits,
    totalWithdrawals,
    todayDeposits,
    todayWithdrawals,
    monthDeposits,
    monthWithdrawals,
    dailySeries,
    monthlySeries,
    denominationBreakdown
  };
}

// src/utils/notice.ts
var NOTICE_TONES = [
  { value: "emerald", label: "Xanh ng\u1ECDc (M\u1EB7c \u0111\u1ECBnh)" },
  { value: "slate", label: "T\u1ED1i gi\u1EA3n (X\xE1m)" },
  { value: "amber", label: "Nh\u1EA5n m\u1EA1nh (V\xE0ng h\u1ED5 ph\xE1ch)" },
  { value: "rose", label: "Kh\u1EA9n c\u1EA5p (\u0110\u1ECF h\u1ED3ng)" }
];
var SOCIAL_PLATFORMS = [
  {
    value: "discord",
    label: "Discord",
    defaultLinkLabel: "Tham gia Discord",
    placeholder: "https://discord.gg/..."
  },
  {
    value: "facebook",
    label: "Facebook",
    defaultLinkLabel: "Theo d\xF5i Facebook",
    placeholder: "https://facebook.com/..."
  },
  {
    value: "telegram",
    label: "Telegram",
    defaultLinkLabel: "K\xEAnh Telegram",
    placeholder: "https://t.me/..."
  },
  {
    value: "zalo",
    label: "Zalo",
    defaultLinkLabel: "Nh\xF3m Zalo h\u1ED7 tr\u1EE3",
    placeholder: "https://zalo.me/..."
  },
  {
    value: "youtube",
    label: "YouTube",
    defaultLinkLabel: "K\xEAnh YouTube",
    placeholder: "https://youtube.com/@..."
  },
  {
    value: "tiktok",
    label: "TikTok",
    defaultLinkLabel: "K\xEAnh TikTok",
    placeholder: "https://tiktok.com/@..."
  },
  {
    value: "x",
    label: "X / Twitter",
    defaultLinkLabel: "Theo d\xF5i tr\xEAn X",
    placeholder: "https://x.com/..."
  },
  {
    value: "website",
    label: "Website / Kh\xE1c",
    defaultLinkLabel: "Truy c\u1EADp li\xEAn k\u1EBFt",
    placeholder: "https://..."
  }
];
var VALID_PLATFORMS = new Set(SOCIAL_PLATFORMS.map((p) => p.value));
var VALID_TONES = new Set(NOTICE_TONES.map((t) => t.value));
function normalizeNoticeTone(tone) {
  return typeof tone === "string" && VALID_TONES.has(tone) ? tone : "emerald";
}
function normalizeSocialPlatform(platform) {
  return typeof platform === "string" && VALID_PLATFORMS.has(platform) ? platform : "website";
}
function isValidSafeHttpUrl(url) {
  const trimmed = url.trim();
  if (!trimmed) return true;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}
function sanitizeNoticeLinks(raw) {
  if (!Array.isArray(raw)) return [];
  const result = [];
  for (let i = 0; i < raw.length && result.length < 10; i++) {
    const item = raw[i];
    if (!item || typeof item !== "object") continue;
    const obj = item;
    const url = typeof obj.url === "string" ? obj.url.trim().slice(0, 300) : "";
    if (!url || !isValidSafeHttpUrl(url)) continue;
    const platform = normalizeSocialPlatform(obj.platform);
    const meta = SOCIAL_PLATFORMS.find((p) => p.value === platform);
    const label = typeof obj.label === "string" && obj.label.trim() ? obj.label.trim().slice(0, 80) : meta?.defaultLinkLabel ?? "Truy c\u1EADp li\xEAn k\u1EBFt";
    const id = typeof obj.id === "string" && obj.id.trim() ? obj.id.trim().slice(0, 64) : `link-${i + 1}`;
    result.push({ id, platform, label, url });
  }
  return result;
}
function parseStoredNoticeLinks(rawJson, legacyDiscordUrl, legacyDiscordLabel) {
  let parsed = [];
  if (typeof rawJson === "string" && rawJson.trim()) {
    try {
      parsed = JSON.parse(rawJson);
    } catch {
      parsed = [];
    }
  }
  const links = sanitizeNoticeLinks(parsed);
  if (links.length > 0) return links;
  const legUrl = typeof legacyDiscordUrl === "string" ? legacyDiscordUrl.trim() : "";
  if (legUrl && isValidSafeHttpUrl(legUrl)) {
    return [
      {
        id: "legacy-discord",
        platform: "discord",
        label: typeof legacyDiscordLabel === "string" && legacyDiscordLabel.trim() ? legacyDiscordLabel.trim().slice(0, 80) : "Tham gia c\u1ED9ng \u0111\u1ED3ng Discord",
        url: legUrl.slice(0, 300)
      }
    ];
  }
  return [];
}

// server.ts
function mapTx(row) {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type === "withdraw" ? "withdraw" : "deposit",
    amount: Math.trunc(Number(row.amount) || 0),
    denomination: row.denomination !== null ? Math.trunc(Number(row.denomination)) : null,
    serialNumber: row.serial_number ?? null,
    serialNormalized: row.serial_normalized ?? null,
    method: row.method === "ai_scan" ? "ai_scan" : "manual",
    note: row.note ?? "",
    aiConfidence: row.ai_confidence !== null ? Number(row.ai_confidence) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
function mapGoal(row, userId) {
  if (!row) {
    return {
      userId,
      title: "Qu\u1EF9 d\u1EF1 ph\xF2ng c\xE1 nh\xE2n",
      targetAmount: 1e7,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
  return {
    userId: row.user_id,
    title: row.title,
    targetAmount: Math.trunc(Number(row.target_amount) || 0),
    updatedAt: row.updated_at
  };
}
function mapAlert(row) {
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
    createdAt: row.created_at
  };
}
function mapChat(row) {
  return {
    id: row.id,
    userId: row.user_id,
    role: row.role === "assistant" ? "assistant" : "user",
    content: row.content,
    createdAt: row.created_at
  };
}
function sanitizePublicError(err, fallback) {
  if (!(err instanceof Error)) return fallback;
  const msg = err.message.trim();
  if (!msg) return fallback;
  if (/turso|libsql|sqlite|\bsql\b|\bhttp\b|turso_database_url|turso_auth_token|econnrefused|fetch failed|enotfound|etimedout/i.test(
    msg
  )) {
    return fallback;
  }
  return msg;
}
async function checkAndLogSerialConflict(params) {
  if (!params.serialNormalized) return { conflict: false };
  const sql = params.excludeTxId ? `SELECT user_id FROM user_transactions WHERE serial_normalized = ? AND user_id != ? AND id != ? LIMIT 1` : `SELECT user_id FROM user_transactions WHERE serial_normalized = ? AND user_id != ? LIMIT 1`;
  const args = params.excludeTxId ? [params.serialNormalized, params.currentUserId, params.excludeTxId] : [params.serialNormalized, params.currentUserId];
  const rows = await dbQuery(sql, args);
  if (rows.length === 0) {
    return { conflict: false };
  }
  const ownerUserId = rows[0].user_id;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const recentThreshold = new Date(Date.now() - 6e4).toISOString();
  const existingRecent = await dbQuery(
    `SELECT id FROM user_security_alerts
     WHERE owner_user_id = ? AND intruder_user_id = ? AND serial_normalized = ? AND created_at >= ?
     LIMIT 1`,
    [ownerUserId, params.currentUserId, params.serialNormalized, recentThreshold]
  );
  if (existingRecent.length === 0) {
    await dbExecute(
      `INSERT INTO user_security_alerts (
        id, owner_user_id, intruder_user_id, intruder_username,
        serial_normalized, serial_display, amount, source, is_read, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      [
        crypto5.randomUUID(),
        ownerUserId,
        params.currentUserId,
        params.currentUsername,
        params.serialNormalized,
        params.serialDisplay || params.serialNormalized,
        Math.max(0, Math.trunc(params.amount)),
        params.source,
        now
      ]
    );
  }
  return {
    conflict: true,
    ownerUserId,
    message: `C\u1EA3nh b\xE1o ch\u1ED1ng l\u1EA5y ti\u1EC1n: S\u1ED1 seri "${params.serialDisplay || params.serialNormalized}" \u0111\xE3 thu\u1ED9c v\u1EC1 t\xE0i kho\u1EA3n kh\xE1c. Giao d\u1ECBch b\u1ECB ch\u1EB7n v\xE0 c\u1EA3nh b\xE1o an to\xE0n \u0111\xE3 \u0111\u01B0\u1EE3c g\u1EEDi t\u1EDBi ch\u1EE7 s\u1EDF h\u1EEFu g\u1ED1c.`
  };
}
async function startServer() {
  await initDatabase();
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "6mb" }));
  app.use("/api", verifyMutationOrigin);
  app.get("/api/health", async (_req, res) => {
    try {
      await dbQuery("SELECT 1 AS ok");
      res.json({ ok: true, database: "connected", timestamp: (/* @__PURE__ */ new Date()).toISOString() });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "DB error" });
    }
  });
  app.get("/api/public/login-notice", async (_req, res, next) => {
    try {
      const [settings, adminRows] = await Promise.all([
        getAiSettings(),
        dbQuery(
          "SELECT id FROM app_users WHERE is_root_admin = 1 OR username = 'admin' LIMIT 1"
        )
      ]);
      const envPass = (process.env.ADMIN_INITIAL_PASSWORD || "").trim();
      const hasEnvPass = Boolean(envPass && envPass !== "CHANGE_ME_INITIAL_ADMIN_PASSWORD");
      const links = parseStoredNoticeLinks(
        settings.login_social_links,
        settings.login_discord_url,
        settings.login_discord_label
      );
      const firstDiscord = links.find((l) => l.platform === "discord");
      res.json({
        enabled: settings.login_notice_enabled !== 0,
        tone: normalizeNoticeTone(settings.login_notice_tone),
        badge: settings.login_notice_badge || "Th\xF4ng b\xE1o",
        title: settings.login_notice_title || "",
        text: settings.login_notice_text || "",
        links,
        discordUrl: firstDiscord?.url || "",
        discordLabel: firstDiscord?.label || "",
        needsInitialAdminSetup: adminRows.length === 0 && !hasEnvPass
      });
    } catch (err) {
      next(err);
    }
  });
  app.post("/api/auth/bootstrap-admin", async (req, res, next) => {
    try {
      const envPass = (process.env.ADMIN_INITIAL_PASSWORD || "").trim();
      if (envPass && envPass !== "CHANGE_ME_INITIAL_ADMIN_PASSWORD") {
        res.status(403).json({ error: "T\xE0i kho\u1EA3n qu\u1EA3n tr\u1ECB g\u1ED1c \u0111\u01B0\u1EE3c qu\u1EA3n l\xFD qua c\u1EA5u h\xECnh m\xF4i tr\u01B0\u1EDDng." });
        return;
      }
      const existing = await dbQuery(
        "SELECT id FROM app_users WHERE is_root_admin = 1 OR username = 'admin' LIMIT 1"
      );
      if (existing.length > 0) {
        res.status(409).json({ error: "T\xE0i kho\u1EA3n qu\u1EA3n tr\u1ECB g\u1ED1c \u0111\xE3 \u0111\u01B0\u1EE3c kh\u1EDFi t\u1EA1o tr\u01B0\u1EDBc \u0111\xF3." });
        return;
      }
      const { password, confirmPassword } = req.body;
      if (typeof password !== "string" || password.length < 6) {
        res.status(400).json({ error: "M\u1EADt kh\u1EA9u qu\u1EA3n tr\u1ECB g\u1ED1c ph\u1EA3i c\xF3 \xEDt nh\u1EA5t 6 k\xFD t\u1EF1." });
        return;
      }
      if (password !== confirmPassword) {
        res.status(400).json({ error: "M\u1EADt kh\u1EA9u nh\u1EADp l\u1EA1i kh\xF4ng kh\u1EDBp." });
        return;
      }
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const adminId = crypto5.randomUUID();
      const passwordHash = await hashPassword(password);
      const passwordEncrypted = encryptSecret(password);
      await dbPipeline([
        {
          sql: `INSERT INTO app_users (
            id, username, password_hash, password_encrypted, display_name, role, is_root_admin,
            is_locked, must_change_password, can_use_camera, can_use_chat, created_at, updated_at
          ) VALUES (?, 'admin', ?, ?, 'Qu\u1EA3n tr\u1ECB g\u1ED1c', 'admin', 1, 0, 0, 1, 1, ?, ?)`,
          args: [adminId, passwordHash, passwordEncrypted, now, now]
        },
        {
          sql: `INSERT INTO user_goals (user_id, title, target_amount, updated_at)
                VALUES (?, 'Qu\u1EF9 d\u1EF1 ph\xF2ng c\xE1 nh\xE2n', 10000000, ?)`,
          args: [adminId, now]
        }
      ]);
      const token = signSessionToken(adminId, 1);
      setSessionCookie(req, res, token);
      const created = await getUserById(adminId);
      res.status(201).json({
        user: created ? mapDbUserToAuthUser(created) : null
      });
    } catch (err) {
      next(err);
    }
  });
  app.get("/api/auth/session", async (req, res, next) => {
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
          message: "T\xE0i kho\u1EA3n n\xE0y \u0111\xE3 b\u1ECB kh\xF3a b\u1EDFi qu\u1EA3n tr\u1ECB vi\xEAn."
        });
        return;
      }
      const tokenSv = typeof payload.sv === "number" ? payload.sv : 1;
      const dbSv = Number(row.session_version ?? 1);
      if (tokenSv !== dbSv) {
        clearSessionCookie(req, res);
        res.status(200).json({ authenticated: false });
        return;
      }
      res.status(200).json({
        authenticated: true,
        user: mapDbUserToAuthUser(row)
      });
    } catch (err) {
      next(err);
    }
  });
  app.post("/api/auth/login", async (req, res, next) => {
    try {
      const { username, password } = req.body;
      const cleanUser = typeof username === "string" ? username.trim().toLowerCase() : "";
      if (!cleanUser || typeof password !== "string" || !password) {
        res.status(400).json({ error: "Vui l\xF2ng nh\u1EADp \u0111\u1EA7y \u0111\u1EE7 t\xEAn \u0111\u0103ng nh\u1EADp v\xE0 m\u1EADt kh\u1EA9u." });
        return;
      }
      const clientIp = req.ip || "unknown";
      const limitKey = `login:${clientIp}:${cleanUser}`;
      const rate = authRateLimiter.check(limitKey);
      if (!rate.allowed) {
        res.status(429).json({
          error: `Qu\xE1 nhi\u1EC1u l\u1EA7n \u0111\u0103ng nh\u1EADp sai. Vui l\xF2ng th\u1EED l\u1EA1i sau ${rate.retryAfterSeconds} gi\xE2y.`
        });
        return;
      }
      const rows = await dbQuery(
        "SELECT * FROM app_users WHERE LOWER(username) = ? LIMIT 1",
        [cleanUser]
      );
      const user = rows[0];
      if (!user) {
        authRateLimiter.recordFailure(limitKey);
        res.status(401).json({ error: "T\xEAn \u0111\u0103ng nh\u1EADp ho\u1EB7c m\u1EADt kh\u1EA9u kh\xF4ng \u0111\xFAng." });
        return;
      }
      const valid = await verifyPassword(password, user.password_hash);
      if (!valid) {
        authRateLimiter.recordFailure(limitKey);
        res.status(401).json({ error: "T\xEAn \u0111\u0103ng nh\u1EADp ho\u1EB7c m\u1EADt kh\u1EA9u kh\xF4ng \u0111\xFAng." });
        return;
      }
      authRateLimiter.clear(limitKey);
      if (!user.password_encrypted || !isEncryptedSecret(user.password_encrypted)) {
        await dbExecute("UPDATE app_users SET password_encrypted = ? WHERE id = ?", [
          encryptSecret(password),
          user.id
        ]);
      }
      if (user.is_locked) {
        clearSessionCookie(req, res);
        res.status(403).json({
          code: "ACCOUNT_LOCKED",
          error: "T\xE0i kho\u1EA3n n\xE0y \u0111\xE3 b\u1ECB kh\xF3a b\u1EDFi qu\u1EA3n tr\u1ECB vi\xEAn."
        });
        return;
      }
      if (Boolean(user.two_factor_enabled) && Boolean(user.two_factor_secret)) {
        const twoFactorToken = signTwoFactorToken(user.id);
        res.json({
          requiresTwoFactor: true,
          twoFactorToken
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
  app.post("/api/auth/verify-2fa", async (req, res, next) => {
    try {
      const { twoFactorToken, code } = req.body;
      const userId = verifyTwoFactorToken(twoFactorToken);
      if (!userId) {
        res.status(401).json({ error: "Phi\xEAn x\xE1c minh 2 b\u01B0\u1EDBc \u0111\xE3 h\u1EBFt h\u1EA1n. Vui l\xF2ng \u0111\u0103ng nh\u1EADp l\u1EA1i." });
        return;
      }
      const clientIp = req.ip || "unknown";
      const limitKey = `2fa:${clientIp}:${userId}`;
      const rate = authRateLimiter.check(limitKey);
      if (!rate.allowed) {
        res.status(429).json({
          error: `Qu\xE1 nhi\u1EC1u l\u1EA7n nh\u1EADp sai m\xE3 2FA. Vui l\xF2ng th\u1EED l\u1EA1i sau ${rate.retryAfterSeconds} gi\xE2y.`
        });
        return;
      }
      const user = await getUserById(userId);
      if (!user) {
        res.status(401).json({ error: "T\xE0i kho\u1EA3n kh\xF4ng t\u1ED3n t\u1EA1i." });
        return;
      }
      if (user.is_locked) {
        clearSessionCookie(req, res);
        res.status(403).json({
          code: "ACCOUNT_LOCKED",
          error: "T\xE0i kho\u1EA3n n\xE0y \u0111\xE3 b\u1ECB kh\xF3a b\u1EDFi qu\u1EA3n tr\u1ECB vi\xEAn."
        });
        return;
      }
      if (!user.two_factor_enabled || !user.two_factor_secret) {
        res.status(400).json({ error: "T\xE0i kho\u1EA3n ch\u01B0a k\xEDch ho\u1EA1t x\xE1c minh 2 b\u01B0\u1EDBc." });
        return;
      }
      const cleanCode = typeof code === "string" ? code.trim() : "";
      const plainSecret = decryptSecret(user.two_factor_secret);
      if (!plainSecret || !verifyTotpCode(plainSecret, cleanCode)) {
        authRateLimiter.recordFailure(limitKey);
        res.status(401).json({ error: "M\xE3 x\xE1c minh 6 s\u1ED1 kh\xF4ng \u0111\xFAng ho\u1EB7c \u0111\xE3 h\u1EBFt h\u1EA1n." });
        return;
      }
      if (!isEncryptedSecret(user.two_factor_secret)) {
        await dbExecute("UPDATE app_users SET two_factor_secret = ? WHERE id = ?", [
          encryptSecret(plainSecret),
          user.id
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
  app.post("/api/auth/logout", (req, res) => {
    clearSessionCookie(req, res);
    res.json({ ok: true });
  });
  app.get("/api/auth/me", requireAuth, async (req, res, next) => {
    try {
      const user = req.authUser;
      const unreadRows = await dbQuery(
        "SELECT COUNT(*) AS cnt FROM user_security_alerts WHERE owner_user_id = ? AND is_read = 0",
        [user.id]
      );
      res.json({
        user,
        unreadAlertsCount: Number(unreadRows[0]?.cnt ?? 0)
      });
    } catch (err) {
      next(err);
    }
  });
  app.post("/api/auth/change-password", requireAuth, async (req, res, next) => {
    try {
      const { oldPassword, newPassword, confirmPassword } = req.body;
      if (!oldPassword || !newPassword || !confirmPassword) {
        res.status(400).json({ error: "Vui l\xF2ng nh\u1EADp \u0111\u1EA7y \u0111\u1EE7 c\u1EA3 3 tr\u01B0\u1EDDng m\u1EADt kh\u1EA9u." });
        return;
      }
      if (newPassword.length < 6) {
        res.status(400).json({ error: "M\u1EADt kh\u1EA9u m\u1EDBi ph\u1EA3i c\xF3 \xEDt nh\u1EA5t 6 k\xFD t\u1EF1." });
        return;
      }
      if (newPassword !== confirmPassword) {
        res.status(400).json({ error: "M\u1EADt kh\u1EA9u m\u1EDBi nh\u1EADp l\u1EA1i kh\xF4ng kh\u1EDBp." });
        return;
      }
      if (oldPassword === newPassword) {
        res.status(400).json({ error: "M\u1EADt kh\u1EA9u m\u1EDBi ph\u1EA3i kh\xE1c m\u1EADt kh\u1EA9u hi\u1EC7n t\u1EA1i." });
        return;
      }
      const clientIp = req.ip || "unknown";
      const limitKey = `chpw:${clientIp}:${req.authUser.id}`;
      const rate = authRateLimiter.check(limitKey);
      if (!rate.allowed) {
        res.status(429).json({
          error: `Th\u1EED sai m\u1EADt kh\u1EA9u qu\xE1 nhi\u1EC1u l\u1EA7n. Vui l\xF2ng th\u1EED l\u1EA1i sau ${rate.retryAfterSeconds} gi\xE2y.`
        });
        return;
      }
      const row = await getUserById(req.authUser.id);
      if (!row) {
        res.status(404).json({ error: "Kh\xF4ng t\xECm th\u1EA5y t\xE0i kho\u1EA3n." });
        return;
      }
      const ok = await verifyPassword(oldPassword, row.password_hash);
      if (!ok) {
        authRateLimiter.recordFailure(limitKey);
        res.status(400).json({ error: "M\u1EADt kh\u1EA9u c\u0169 kh\xF4ng ch\xEDnh x\xE1c." });
        return;
      }
      authRateLimiter.clear(limitKey);
      const newHash = await hashPassword(newPassword);
      const newEncrypted = encryptSecret(newPassword);
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const nextSv = Number(row.session_version ?? 1) + 1;
      await dbExecute(
        "UPDATE app_users SET password_hash = ?, password_encrypted = ?, must_change_password = 0, session_version = ?, updated_at = ? WHERE id = ?",
        [newHash, newEncrypted, nextSv, now, row.id]
      );
      setSessionCookie(req, res, signSessionToken(row.id, nextSv));
      const updated = await getUserById(row.id);
      res.json({ user: updated ? mapDbUserToAuthUser(updated) : req.authUser });
    } catch (err) {
      next(err);
    }
  });
  app.post("/api/auth/2fa/setup", requireAuth, async (req, res, next) => {
    try {
      const { currentPassword } = req.body;
      if (typeof currentPassword !== "string" || !currentPassword) {
        res.status(400).json({ error: "Vui l\xF2ng nh\u1EADp m\u1EADt kh\u1EA9u hi\u1EC7n t\u1EA1i \u0111\u1EC3 b\u1EAFt \u0111\u1EA7u b\u1EADt 2FA." });
        return;
      }
      const clientIp = req.ip || "unknown";
      const limitKey = `2fa-sec:${clientIp}:${req.authUser.id}`;
      const rate = authRateLimiter.check(limitKey);
      if (!rate.allowed) {
        res.status(429).json({
          error: `Th\u1EED sai qu\xE1 nhi\u1EC1u l\u1EA7n. Vui l\xF2ng th\u1EED l\u1EA1i sau ${rate.retryAfterSeconds} gi\xE2y.`
        });
        return;
      }
      const row = await getUserById(req.authUser.id);
      if (!row) {
        res.status(404).json({ error: "Kh\xF4ng t\xECm th\u1EA5y t\xE0i kho\u1EA3n." });
        return;
      }
      if (row.two_factor_enabled) {
        res.status(400).json({ error: "X\xE1c minh 2 b\u01B0\u1EDBc hi\u1EC7n \u0111ang \u0111\u01B0\u1EE3c b\u1EADt cho t\xE0i kho\u1EA3n n\xE0y." });
        return;
      }
      const passwordOk = await verifyPassword(currentPassword, row.password_hash);
      if (!passwordOk) {
        authRateLimiter.recordFailure(limitKey);
        res.status(400).json({ error: "M\u1EADt kh\u1EA9u hi\u1EC7n t\u1EA1i kh\xF4ng ch\xEDnh x\xE1c." });
        return;
      }
      authRateLimiter.clear(limitKey);
      const secret = generateBase32Secret(20);
      const otpauthUri = buildOtpAuthUri({
        issuer: "V\xED Ti\u1EBFt Ki\u1EC7m C\xE1 Nh\xE2n",
        accountName: row.username,
        secret
      });
      const qrDataUrl = await generateQrDataUrl(otpauthUri);
      await dbExecute(
        "UPDATE app_users SET two_factor_pending_secret = ?, updated_at = ? WHERE id = ?",
        [encryptSecret(secret), (/* @__PURE__ */ new Date()).toISOString(), row.id]
      );
      res.json({ secret, qrDataUrl });
    } catch (err) {
      next(err);
    }
  });
  app.post("/api/auth/2fa/confirm", requireAuth, async (req, res, next) => {
    try {
      const { currentPassword, code } = req.body;
      if (typeof currentPassword !== "string" || !currentPassword) {
        res.status(400).json({ error: "Vui l\xF2ng nh\u1EADp m\u1EADt kh\u1EA9u hi\u1EC7n t\u1EA1i \u0111\u1EC3 x\xE1c nh\u1EADn b\u1EADt 2FA." });
        return;
      }
      const cleanCode = typeof code === "string" ? code.trim() : "";
      if (!/^\d{6}$/.test(cleanCode.replace(/\s+/g, ""))) {
        res.status(400).json({ error: "Vui l\xF2ng nh\u1EADp \u0111\xFAng m\xE3 x\xE1c minh g\u1ED3m 6 ch\u1EEF s\u1ED1." });
        return;
      }
      const clientIp = req.ip || "unknown";
      const limitKey = `2fa-sec:${clientIp}:${req.authUser.id}`;
      const rate = authRateLimiter.check(limitKey);
      if (!rate.allowed) {
        res.status(429).json({
          error: `Th\u1EED sai qu\xE1 nhi\u1EC1u l\u1EA7n. Vui l\xF2ng th\u1EED l\u1EA1i sau ${rate.retryAfterSeconds} gi\xE2y.`
        });
        return;
      }
      const row = await getUserById(req.authUser.id);
      if (!row) {
        res.status(404).json({ error: "Kh\xF4ng t\xECm th\u1EA5y t\xE0i kho\u1EA3n." });
        return;
      }
      if (!row.two_factor_pending_secret) {
        res.status(400).json({ error: "Ch\u01B0a c\xF3 m\xE3 thi\u1EBFt l\u1EADp 2FA. Vui l\xF2ng kh\u1EDFi t\u1EA1o l\u1EA1i m\xE3 QR." });
        return;
      }
      const passwordOk = await verifyPassword(currentPassword, row.password_hash);
      if (!passwordOk) {
        authRateLimiter.recordFailure(limitKey);
        res.status(400).json({ error: "M\u1EADt kh\u1EA9u x\xE1c nh\u1EADn kh\xF4ng ch\xEDnh x\xE1c." });
        return;
      }
      const pendingPlainSecret = decryptSecret(row.two_factor_pending_secret);
      if (!pendingPlainSecret || !verifyTotpCode(pendingPlainSecret, cleanCode)) {
        authRateLimiter.recordFailure(limitKey);
        res.status(400).json({ error: "M\xE3 6 s\u1ED1 t\u1EEB \u1EE9ng d\u1EE5ng x\xE1c th\u1EF1c kh\xF4ng kh\u1EDBp. Vui l\xF2ng th\u1EED l\u1EA1i." });
        return;
      }
      authRateLimiter.clear(limitKey);
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const nextSv = Number(row.session_version ?? 1) + 1;
      await dbExecute(
        `UPDATE app_users
         SET two_factor_enabled = 1, two_factor_secret = ?, two_factor_pending_secret = '', session_version = ?, updated_at = ?
         WHERE id = ?`,
        [encryptSecret(pendingPlainSecret), nextSv, now, row.id]
      );
      setSessionCookie(req, res, signSessionToken(row.id, nextSv));
      const updated = await getUserById(row.id);
      res.json({ user: updated ? mapDbUserToAuthUser(updated) : req.authUser });
    } catch (err) {
      next(err);
    }
  });
  app.post("/api/auth/2fa/disable", requireAuth, async (req, res, next) => {
    try {
      const { currentPassword, code } = req.body;
      if (typeof currentPassword !== "string" || !currentPassword) {
        res.status(400).json({ error: "Vui l\xF2ng nh\u1EADp m\u1EADt kh\u1EA9u hi\u1EC7n t\u1EA1i \u0111\u1EC3 t\u1EAFt 2FA." });
        return;
      }
      const cleanCode = typeof code === "string" ? code.trim() : "";
      if (!/^\d{6}$/.test(cleanCode.replace(/\s+/g, ""))) {
        res.status(400).json({ error: "Vui l\xF2ng nh\u1EADp m\xE3 x\xE1c minh 6 ch\u1EEF s\u1ED1 \u0111\u1EC3 t\u1EAFt 2FA." });
        return;
      }
      const clientIp = req.ip || "unknown";
      const limitKey = `2fa-sec:${clientIp}:${req.authUser.id}`;
      const rate = authRateLimiter.check(limitKey);
      if (!rate.allowed) {
        res.status(429).json({
          error: `Th\u1EED sai qu\xE1 nhi\u1EC1u l\u1EA7n. Vui l\xF2ng th\u1EED l\u1EA1i sau ${rate.retryAfterSeconds} gi\xE2y.`
        });
        return;
      }
      const row = await getUserById(req.authUser.id);
      if (!row) {
        res.status(404).json({ error: "Kh\xF4ng t\xECm th\u1EA5y t\xE0i kho\u1EA3n." });
        return;
      }
      if (!row.two_factor_enabled || !row.two_factor_secret) {
        res.status(400).json({ error: "T\xE0i kho\u1EA3n n\xE0y ch\u01B0a b\u1EADt x\xE1c minh 2 b\u01B0\u1EDBc." });
        return;
      }
      const passwordOk = await verifyPassword(currentPassword, row.password_hash);
      if (!passwordOk) {
        authRateLimiter.recordFailure(limitKey);
        res.status(400).json({ error: "M\u1EADt kh\u1EA9u hi\u1EC7n t\u1EA1i kh\xF4ng ch\xEDnh x\xE1c." });
        return;
      }
      const plainSecret = decryptSecret(row.two_factor_secret);
      if (!plainSecret || !verifyTotpCode(plainSecret, cleanCode)) {
        authRateLimiter.recordFailure(limitKey);
        res.status(400).json({ error: "M\xE3 6 s\u1ED1 t\u1EEB \u1EE9ng d\u1EE5ng x\xE1c th\u1EF1c kh\xF4ng \u0111\xFAng." });
        return;
      }
      authRateLimiter.clear(limitKey);
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const nextSv = Number(row.session_version ?? 1) + 1;
      await dbExecute(
        `UPDATE app_users
         SET two_factor_enabled = 0, two_factor_secret = '', two_factor_pending_secret = '', session_version = ?, updated_at = ?
         WHERE id = ?`,
        [nextSv, now, row.id]
      );
      setSessionCookie(req, res, signSessionToken(row.id, nextSv));
      const updated = await getUserById(row.id);
      res.json({ user: updated ? mapDbUserToAuthUser(updated) : req.authUser });
    } catch (err) {
      next(err);
    }
  });
  app.get("/api/transactions", requireAuth, async (req, res, next) => {
    try {
      const userId = req.authUser.id;
      const typeFilter = typeof req.query.type === "string" ? req.query.type : "";
      const methodFilter = typeof req.query.method === "string" ? req.query.method : "";
      const search = typeof req.query.search === "string" ? req.query.search.trim().toLowerCase() : "";
      let sql = "SELECT * FROM user_transactions WHERE user_id = ?";
      const args = [userId];
      if (typeFilter === "deposit" || typeFilter === "withdraw") {
        sql += " AND type = ?";
        args.push(typeFilter);
      }
      if (methodFilter === "manual" || methodFilter === "ai_scan") {
        sql += " AND method = ?";
        args.push(methodFilter);
      }
      sql += " ORDER BY created_at DESC";
      const rows = await dbQuery(sql, args);
      let items = rows.map(mapTx);
      if (search) {
        const searchNorm = normalizeSerial(search);
        items = items.filter(
          (tx) => tx.note.toLowerCase().includes(search) || tx.serialNumber && tx.serialNumber.toLowerCase().includes(search) || tx.serialNormalized && searchNorm && tx.serialNormalized.includes(searchNorm) || String(tx.amount).includes(search)
        );
      }
      res.json({ transactions: items });
    } catch (err) {
      next(err);
    }
  });
  app.post("/api/transactions", requireAuth, async (req, res, next) => {
    try {
      const user = req.authUser;
      const body = req.body;
      const type = body.type === "withdraw" ? "withdraw" : body.type === "deposit" ? "deposit" : null;
      if (!type) {
        res.status(400).json({ error: "Lo\u1EA1i giao d\u1ECBch ph\u1EA3i l\xE0 deposit ho\u1EB7c withdraw." });
        return;
      }
      const amount = typeof body.amount === "number" ? Math.trunc(body.amount) : NaN;
      if (!Number.isSafeInteger(amount) || amount <= 0) {
        res.status(400).json({ error: "S\u1ED1 ti\u1EC1n ph\u1EA3i l\xE0 s\u1ED1 nguy\xEAn d\u01B0\u01A1ng (VN\u0110)." });
        return;
      }
      const method = body.method === "ai_scan" ? "ai_scan" : "manual";
      const denomination = typeof body.denomination === "number" && Number.isSafeInteger(body.denomination) && body.denomination > 0 ? body.denomination : null;
      const serialDisplay = typeof body.serialNumber === "string" && body.serialNumber.trim() ? body.serialNumber.trim().slice(0, 40) : null;
      const serialNormalized = serialDisplay ? normalizeSerial(serialDisplay) || null : null;
      const note = typeof body.note === "string" ? body.note.trim().slice(0, 240) : "";
      const aiConfidence = typeof body.aiConfidence === "number" && Number.isFinite(body.aiConfidence) ? Math.min(1, Math.max(0, body.aiConfidence)) : null;
      if (serialNormalized) {
        const conflictCheck = await checkAndLogSerialConflict({
          serialNormalized,
          serialDisplay: serialDisplay || serialNormalized,
          currentUserId: user.id,
          currentUsername: user.username,
          amount,
          source: method
        });
        if (conflictCheck.conflict) {
          res.status(409).json({
            code: "SERIAL_CONFLICT",
            error: conflictCheck.message
          });
          return;
        }
      }
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const createdAt = typeof body.createdAt === "string" && !Number.isNaN(Date.parse(body.createdAt)) ? new Date(body.createdAt).toISOString() : now;
      const id = crypto5.randomUUID();
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
          now
        ]
      );
      const createdRows = await dbQuery("SELECT * FROM user_transactions WHERE id = ? LIMIT 1", [id]);
      res.status(201).json({ transaction: mapTx(createdRows[0]) });
    } catch (err) {
      next(err);
    }
  });
  app.put("/api/transactions/:id", requireAuth, async (req, res, next) => {
    try {
      const user = req.authUser;
      const txId = req.params.id;
      const existingRows = await dbQuery(
        "SELECT * FROM user_transactions WHERE id = ? AND user_id = ? LIMIT 1",
        [txId, user.id]
      );
      if (existingRows.length === 0) {
        res.status(404).json({ error: "Kh\xF4ng t\xECm th\u1EA5y giao d\u1ECBch." });
        return;
      }
      const body = req.body;
      const type = body.type === "withdraw" ? "withdraw" : "deposit";
      const amount = typeof body.amount === "number" ? Math.trunc(body.amount) : NaN;
      if (!Number.isSafeInteger(amount) || amount <= 0) {
        res.status(400).json({ error: "S\u1ED1 ti\u1EC1n ph\u1EA3i l\xE0 s\u1ED1 nguy\xEAn d\u01B0\u01A1ng (VN\u0110)." });
        return;
      }
      const denomination = typeof body.denomination === "number" && Number.isSafeInteger(body.denomination) && body.denomination > 0 ? body.denomination : null;
      const serialDisplay = typeof body.serialNumber === "string" && body.serialNumber.trim() ? body.serialNumber.trim().slice(0, 40) : null;
      const serialNormalized = serialDisplay ? normalizeSerial(serialDisplay) || null : null;
      const note = typeof body.note === "string" ? body.note.trim().slice(0, 240) : "";
      if (serialNormalized) {
        const conflictCheck = await checkAndLogSerialConflict({
          serialNormalized,
          serialDisplay: serialDisplay || serialNormalized,
          currentUserId: user.id,
          currentUsername: user.username,
          amount,
          source: "manual",
          excludeTxId: txId
        });
        if (conflictCheck.conflict) {
          res.status(409).json({
            code: "SERIAL_CONFLICT",
            error: conflictCheck.message
          });
          return;
        }
      }
      const now = (/* @__PURE__ */ new Date()).toISOString();
      await dbExecute(
        `UPDATE user_transactions
         SET type = ?, amount = ?, denomination = ?, serial_number = ?, serial_normalized = ?, note = ?, updated_at = ?
         WHERE id = ? AND user_id = ?`,
        [type, amount, denomination, serialDisplay, serialNormalized, note, now, txId, user.id]
      );
      const updatedRows = await dbQuery("SELECT * FROM user_transactions WHERE id = ? LIMIT 1", [txId]);
      res.json({ transaction: mapTx(updatedRows[0]) });
    } catch (err) {
      next(err);
    }
  });
  app.delete("/api/transactions/:id", requireAuth, async (req, res, next) => {
    try {
      const user = req.authUser;
      const txId = req.params.id;
      const { affectedRows } = await dbExecute(
        "DELETE FROM user_transactions WHERE id = ? AND user_id = ?",
        [txId, user.id]
      );
      if (affectedRows === 0) {
        res.status(404).json({ error: "Kh\xF4ng t\xECm th\u1EA5y giao d\u1ECBch \u0111\u1EC3 x\xF3a." });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });
  app.get("/api/goal", requireAuth, async (req, res, next) => {
    try {
      const rows = await dbQuery("SELECT * FROM user_goals WHERE user_id = ? LIMIT 1", [
        req.authUser.id
      ]);
      res.json({ goal: mapGoal(rows[0], req.authUser.id) });
    } catch (err) {
      next(err);
    }
  });
  app.put("/api/goal", requireAuth, async (req, res, next) => {
    try {
      const userId = req.authUser.id;
      const { title, targetAmount } = req.body;
      const cleanTitle = typeof title === "string" && title.trim() ? title.trim().slice(0, 120) : "M\u1EE5c ti\xEAu ti\u1EBFt ki\u1EC7m";
      const parsedTarget = typeof targetAmount === "number" ? Math.trunc(targetAmount) : NaN;
      if (!Number.isSafeInteger(parsedTarget) || parsedTarget <= 0) {
        res.status(400).json({ error: "S\u1ED1 ti\u1EC1n m\u1EE5c ti\xEAu ph\u1EA3i l\xE0 s\u1ED1 nguy\xEAn d\u01B0\u01A1ng (VN\u0110)." });
        return;
      }
      const now = (/* @__PURE__ */ new Date()).toISOString();
      await dbExecute(
        `INSERT INTO user_goals (user_id, title, target_amount, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           title = excluded.title,
           target_amount = excluded.target_amount,
           updated_at = excluded.updated_at`,
        [userId, cleanTitle, parsedTarget, now]
      );
      res.json({
        goal: {
          userId,
          title: cleanTitle,
          targetAmount: parsedTarget,
          updatedAt: now
        }
      });
    } catch (err) {
      next(err);
    }
  });
  app.get("/api/security-alerts", requireAuth, async (req, res, next) => {
    try {
      const rows = await dbQuery(
        "SELECT * FROM user_security_alerts WHERE owner_user_id = ? ORDER BY created_at DESC LIMIT 50",
        [req.authUser.id]
      );
      res.json({ alerts: rows.map(mapAlert) });
    } catch (err) {
      next(err);
    }
  });
  app.patch("/api/security-alerts/:id/read", requireAuth, async (req, res, next) => {
    try {
      await dbExecute(
        "UPDATE user_security_alerts SET is_read = 1 WHERE id = ? AND owner_user_id = ?",
        [req.params.id, req.authUser.id]
      );
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });
  app.post("/api/security-alerts/read-all", requireAuth, async (req, res, next) => {
    try {
      await dbExecute("UPDATE user_security_alerts SET is_read = 1 WHERE owner_user_id = ?", [
        req.authUser.id
      ]);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });
  app.post("/api/ai/scan-bill", requireAuth, async (req, res, next) => {
    try {
      const user = req.authUser;
      if (!user.canUseCamera && user.role !== "admin") {
        res.status(403).json({ error: "T\xE0i kho\u1EA3n c\u1EE7a b\u1EA1n kh\xF4ng \u0111\u01B0\u1EE3c c\u1EA5p quy\u1EC1n qu\xE9t camera AI." });
        return;
      }
      const { imageDataUrl } = req.body;
      if (typeof imageDataUrl !== "string" || !imageDataUrl.startsWith("data:image/")) {
        res.status(400).json({ error: "Vui l\xF2ng g\u1EEDi \u1EA3nh t\u1EDD ti\u1EC1n h\u1EE3p l\u1EC7." });
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
          source: "ai_scan"
        });
        if (conflictCheck.conflict) {
          result.serialConflict = {
            isConflict: true,
            message: conflictCheck.message || "S\u1ED1 seri \u0111\xE3 t\u1ED3n t\u1EA1i \u1EDF t\xE0i kho\u1EA3n kh\xE1c."
          };
        }
      }
      res.json(result);
    } catch (err) {
      console.error("[AI Scan Error]", err);
      res.status(502).json({
        error: sanitizePublicError(err, "Kh\xF4ng th\u1EC3 ph\xE2n t\xEDch \u1EA3nh t\u1EDD ti\u1EC1n l\xFAc n\xE0y.")
      });
    }
  });
  app.get("/api/advisor/messages", requireAuth, async (req, res, next) => {
    try {
      const rows = await dbQuery(
        "SELECT * FROM user_chat_messages WHERE user_id = ? ORDER BY created_at ASC LIMIT 100",
        [req.authUser.id]
      );
      res.json({ messages: rows.map(mapChat) });
    } catch (err) {
      next(err);
    }
  });
  app.post("/api/advisor/chat", requireAuth, async (req, res, next) => {
    try {
      const user = req.authUser;
      if (!user.canUseChat && user.role !== "admin") {
        res.status(403).json({ error: "T\xE0i kho\u1EA3n c\u1EE7a b\u1EA1n kh\xF4ng \u0111\u01B0\u1EE3c c\u1EA5p quy\u1EC1n Tr\u1EE3 l\xFD AI." });
        return;
      }
      const { message } = req.body;
      const cleanMessage = typeof message === "string" ? message.trim().slice(0, 1500) : "";
      if (!cleanMessage) {
        res.status(400).json({ error: "Vui l\xF2ng nh\u1EADp n\u1ED9i dung c\xE2u h\u1ECFi t\xE0i ch\xEDnh." });
        return;
      }
      const [txRows, goalRows, historyRows, settings] = await Promise.all([
        dbQuery("SELECT * FROM user_transactions WHERE user_id = ? ORDER BY created_at DESC", [
          user.id
        ]),
        dbQuery("SELECT * FROM user_goals WHERE user_id = ? LIMIT 1", [user.id]),
        dbQuery(
          "SELECT * FROM user_chat_messages WHERE user_id = ? ORDER BY created_at ASC LIMIT 20",
          [user.id]
        ),
        getAiSettings()
      ]);
      const txs = txRows.map(mapTx);
      const goal = mapGoal(goalRows[0], user.id);
      const summary = computeCashflowSummary(txs);
      const progressPct = goal.targetAmount > 0 ? Math.min(100, Math.round(summary.netBalance / goal.targetAmount * 100)) : 0;
      const financialContext = [
        `- Ng\u01B0\u1EDDi d\xF9ng: ${user.displayName} (@${user.username})`,
        `- S\u1ED1 d\u01B0 r\xF2ng hi\u1EC7n t\u1EA1i: ${formatVnd(summary.netBalance)}`,
        `- T\u1ED5ng \u0111\xE3 n\u1EA1p: ${formatVnd(summary.totalDeposits)} | T\u1ED5ng \u0111\xE3 r\xFAt: ${formatVnd(summary.totalWithdrawals)}`,
        `- N\u1EA1p h\xF4m nay: ${formatVnd(summary.todayDeposits)} | N\u1EA1p th\xE1ng n\xE0y: ${formatVnd(summary.monthDeposits)}`,
        `- M\u1EE5c ti\xEAu "${goal.title}": ${formatVnd(goal.targetAmount)} (\u0111\u1EA1t ${progressPct}%)`,
        `- S\u1ED1 giao d\u1ECBch: ${txs.length}`
      ].join("\n");
      const history = historyRows.map((h) => ({
        role: h.role === "assistant" ? "assistant" : "user",
        content: h.content
      }));
      const reply = await advisorChatWithAi(settings, financialContext, history, cleanMessage);
      const userTime = (/* @__PURE__ */ new Date()).toISOString();
      const assistantTime = new Date(Date.now() + 5).toISOString();
      const userMsgId = crypto5.randomUUID();
      const assistantMsgId = crypto5.randomUUID();
      await dbPipeline([
        {
          sql: "INSERT INTO user_chat_messages (id, user_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
          args: [userMsgId, user.id, "user", cleanMessage, userTime]
        },
        {
          sql: "INSERT INTO user_chat_messages (id, user_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
          args: [assistantMsgId, user.id, "assistant", reply, assistantTime]
        }
      ]);
      res.json({
        userMessage: {
          id: userMsgId,
          userId: user.id,
          role: "user",
          content: cleanMessage,
          createdAt: userTime
        },
        assistantMessage: {
          id: assistantMsgId,
          userId: user.id,
          role: "assistant",
          content: reply,
          createdAt: assistantTime
        }
      });
    } catch (err) {
      console.error("[AI Advisor Error]", err);
      res.status(502).json({
        error: sanitizePublicError(err, "Tr\u1EE3 l\xFD AI hi\u1EC7n kh\xF4ng ph\u1EA3n h\u1ED3i.")
      });
    }
  });
  app.delete("/api/advisor/messages", requireAuth, async (req, res, next) => {
    try {
      await dbExecute("DELETE FROM user_chat_messages WHERE user_id = ?", [req.authUser.id]);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });
  app.get("/api/admin/users", requireAuth, requireAdmin, async (_req, res, next) => {
    try {
      const rows = await dbQuery(
        "SELECT * FROM app_users ORDER BY is_root_admin DESC, created_at ASC"
      );
      res.json({ users: rows.map(mapDbUserToAuthUser) });
    } catch (err) {
      next(err);
    }
  });
  app.post("/api/admin/users", requireAuth, requireAdmin, async (req, res, next) => {
    try {
      const { username, displayName, password, role, canUseCamera, canUseChat } = req.body;
      const cleanUsername = typeof username === "string" ? username.trim().toLowerCase() : "";
      if (!/^[a-z0-9_.-]{3,32}$/.test(cleanUsername)) {
        res.status(400).json({
          error: "T\xEAn \u0111\u0103ng nh\u1EADp g\u1ED3m 3-32 k\xFD t\u1EF1 ch\u1EEF th\u01B0\u1EDDng, s\u1ED1, d\u1EA5u g\u1EA1ch d\u01B0\u1EDBi ho\u1EB7c d\u1EA5u ch\u1EA5m."
        });
        return;
      }
      if (typeof password !== "string" || password.length < 6) {
        res.status(400).json({ error: "M\u1EADt kh\u1EA9u kh\u1EDFi t\u1EA1o ph\u1EA3i c\xF3 \xEDt nh\u1EA5t 6 k\xFD t\u1EF1." });
        return;
      }
      const existing = await dbQuery(
        "SELECT id FROM app_users WHERE LOWER(username) = ? LIMIT 1",
        [cleanUsername]
      );
      if (existing.length > 0) {
        res.status(409).json({ error: "T\xEAn \u0111\u0103ng nh\u1EADp n\xE0y \u0111\xE3 t\u1ED3n t\u1EA1i." });
        return;
      }
      const cleanDisplay = typeof displayName === "string" && displayName.trim() ? displayName.trim().slice(0, 80) : cleanUsername;
      const cleanRole = role === "admin" ? "admin" : "user";
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const userId = crypto5.randomUUID();
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
            now
          ]
        },
        {
          sql: `INSERT INTO user_goals (user_id, title, target_amount, updated_at)
                VALUES (?, 'M\u1EE5c ti\xEAu ti\u1EBFt ki\u1EC7m', 10000000, ?)`,
          args: [userId, now]
        }
      ]);
      const created = await getUserById(userId);
      res.status(201).json({ user: created ? mapDbUserToAuthUser(created) : null });
    } catch (err) {
      next(err);
    }
  });
  app.put("/api/admin/users/:id", requireAuth, requireAdmin, async (req, res, next) => {
    try {
      const actor = req.authUser;
      const target = await getUserById(req.params.id);
      if (!target) {
        res.status(404).json({ error: "Kh\xF4ng t\xECm th\u1EA5y t\xE0i kho\u1EA3n." });
        return;
      }
      const { displayName, role, isLocked } = req.body;
      if (target.is_root_admin) {
        if (isLocked === true || role === "user") {
          res.status(403).json({
            error: "T\xE0i kho\u1EA3n Qu\u1EA3n tr\u1ECB g\u1ED1c \u0111\u01B0\u1EE3c b\u1EA3o v\u1EC7: kh\xF4ng th\u1EC3 kh\xF3a ho\u1EB7c h\u1EA1 quy\u1EC1n."
          });
          return;
        }
        if (!actor.isRootAdmin) {
          res.status(403).json({
            error: "Admin ph\u1EE5 kh\xF4ng th\u1EC3 ch\u1EC9nh s\u1EEDa t\xE0i kho\u1EA3n Qu\u1EA3n tr\u1ECB g\u1ED1c."
          });
          return;
        }
      }
      if (isLocked === true) {
        const lockDecision = checkAdminSelfAction({
          actorId: actor.id,
          targetId: target.id,
          action: "lock"
        });
        if (!lockDecision.allowed) {
          res.status(lockDecision.status).json({ error: lockDecision.error });
          return;
        }
      }
      if (role !== void 0 && role !== "admin") {
        const demoteDecision = checkAdminSelfAction({
          actorId: actor.id,
          targetId: target.id,
          action: "demote"
        });
        if (!demoteDecision.allowed) {
          res.status(demoteDecision.status).json({ error: demoteDecision.error });
          return;
        }
      }
      const nextDisplay = typeof displayName === "string" && displayName.trim() ? displayName.trim().slice(0, 80) : target.display_name;
      const nextRole = target.is_root_admin ? "admin" : role === "admin" ? "admin" : "user";
      const nextLocked = target.is_root_admin ? 0 : isLocked ? 1 : 0;
      const now = (/* @__PURE__ */ new Date()).toISOString();
      await dbExecute(
        "UPDATE app_users SET display_name = ?, role = ?, is_locked = ?, updated_at = ? WHERE id = ?",
        [nextDisplay, nextRole, nextLocked, now, target.id]
      );
      const updated = await getUserById(target.id);
      res.json({ user: updated ? mapDbUserToAuthUser(updated) : null });
    } catch (err) {
      next(err);
    }
  });
  app.patch("/api/admin/users/:id/permissions", requireAuth, requireAdmin, async (req, res, next) => {
    try {
      const actor = req.authUser;
      const target = await getUserById(req.params.id);
      if (!target) {
        res.status(404).json({ error: "Kh\xF4ng t\xECm th\u1EA5y t\xE0i kho\u1EA3n." });
        return;
      }
      if (target.is_root_admin && !actor.isRootAdmin) {
        res.status(403).json({
          error: "Admin ph\u1EE5 kh\xF4ng th\u1EC3 thay \u0111\u1ED5i quy\u1EC1n c\u1EE7a Qu\u1EA3n tr\u1ECB g\u1ED1c."
        });
        return;
      }
      const { canUseCamera, canUseChat } = req.body;
      const nextCam = typeof canUseCamera === "boolean" ? canUseCamera ? 1 : 0 : target.can_use_camera;
      const nextChat = typeof canUseChat === "boolean" ? canUseChat ? 1 : 0 : target.can_use_chat;
      await dbExecute(
        "UPDATE app_users SET can_use_camera = ?, can_use_chat = ?, updated_at = ? WHERE id = ?",
        [nextCam, nextChat, (/* @__PURE__ */ new Date()).toISOString(), target.id]
      );
      const updated = await getUserById(target.id);
      res.json({ user: updated ? mapDbUserToAuthUser(updated) : null });
    } catch (err) {
      next(err);
    }
  });
  app.post("/api/admin/users/bulk-permissions", requireAuth, requireAdmin, async (req, res, next) => {
    try {
      const { canUseCamera, canUseChat } = req.body;
      const sets = [];
      const args = [];
      if (typeof canUseCamera === "boolean") {
        sets.push("can_use_camera = ?");
        args.push(canUseCamera ? 1 : 0);
      }
      if (typeof canUseChat === "boolean") {
        sets.push("can_use_chat = ?");
        args.push(canUseChat ? 1 : 0);
      }
      if (sets.length === 0) {
        res.status(400).json({ error: "Kh\xF4ng c\xF3 quy\u1EC1n n\xE0o \u0111\u01B0\u1EE3c ch\u1ECDn \u0111\u1EC3 c\u1EADp nh\u1EADt." });
        return;
      }
      sets.push("updated_at = ?");
      args.push((/* @__PURE__ */ new Date()).toISOString());
      await dbExecute(
        `UPDATE app_users SET ${sets.join(", ")} WHERE is_root_admin = 0`,
        args
      );
      const rows = await dbQuery(
        "SELECT * FROM app_users ORDER BY is_root_admin DESC, created_at ASC"
      );
      res.json({ users: rows.map(mapDbUserToAuthUser) });
    } catch (err) {
      next(err);
    }
  });
  app.post("/api/admin/users/:id/reset-password", requireAuth, requireAdmin, async (req, res, next) => {
    try {
      const actor = req.authUser;
      const target = await getUserById(req.params.id);
      if (!target) {
        res.status(404).json({ error: "Kh\xF4ng t\xECm th\u1EA5y t\xE0i kho\u1EA3n." });
        return;
      }
      if (target.is_root_admin && !actor.isRootAdmin) {
        res.status(403).json({
          error: "Admin ph\u1EE5 kh\xF4ng th\u1EC3 \u0111\u1EB7t l\u1EA1i m\u1EADt kh\u1EA9u c\u1EE7a Qu\u1EA3n tr\u1ECB g\u1ED1c."
        });
        return;
      }
      const { newPassword, oldPassword } = req.body;
      if (typeof newPassword !== "string" || newPassword.length < 6) {
        res.status(400).json({ error: "M\u1EADt kh\u1EA9u m\u1EDBi ph\u1EA3i c\xF3 \xEDt nh\u1EA5t 6 k\xFD t\u1EF1." });
        return;
      }
      const isSelfReset = requiresOldPasswordForAdminReset(actor.id, target.id);
      if (isSelfReset) {
        if (typeof oldPassword !== "string" || !oldPassword) {
          res.status(400).json({ error: "Kh\xF4ng th\u1EC3 t\u1EF1 \u0111\u1ED5i m\u1EADt kh\u1EA9u m\xE0 kh\xF4ng c\xF3 m\u1EADt kh\u1EA9u c\u0169." });
          return;
        }
        const oldOk = await verifyPassword(oldPassword, target.password_hash);
        if (!oldOk) {
          res.status(400).json({ error: "M\u1EADt kh\u1EA9u c\u0169 kh\xF4ng ch\xEDnh x\xE1c." });
          return;
        }
        if (newPassword === oldPassword) {
          res.status(400).json({ error: "M\u1EADt kh\u1EA9u m\u1EDBi ph\u1EA3i kh\xE1c m\u1EADt kh\u1EA9u hi\u1EC7n t\u1EA1i." });
          return;
        }
      }
      const hash = await hashPassword(newPassword);
      const encrypted = encryptSecret(newPassword);
      const nextSv = Number(target.session_version ?? 1) + 1;
      await dbExecute(
        "UPDATE app_users SET password_hash = ?, password_encrypted = ?, must_change_password = ?, session_version = ?, updated_at = ? WHERE id = ?",
        [hash, encrypted, isSelfReset ? 0 : 1, nextSv, (/* @__PURE__ */ new Date()).toISOString(), target.id]
      );
      if (isSelfReset) {
        setSessionCookie(req, res, signSessionToken(target.id, nextSv));
      }
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });
  app.post("/api/admin/users/:id/credentials", requireAuth, requireAdmin, async (req, res, next) => {
    try {
      const actor = req.authUser;
      const target = await getUserById(req.params.id);
      if (!target) {
        res.status(404).json({ error: "Kh\xF4ng t\xECm th\u1EA5y t\xE0i kho\u1EA3n." });
        return;
      }
      const acl = canInspectUserCredentials(
        { id: actor.id, isRootAdmin: actor.isRootAdmin },
        { id: target.id, role: target.role, isRootAdmin: Boolean(target.is_root_admin) }
      );
      if (!acl.allowed) {
        res.status(acl.status).json({ error: acl.error });
        return;
      }
      const { adminPassword } = req.body;
      if (typeof adminPassword !== "string" || !adminPassword) {
        res.status(400).json({ error: "Vui l\xF2ng nh\u1EADp m\u1EADt kh\u1EA9u qu\u1EA3n tr\u1ECB c\u1EE7a b\u1EA1n \u0111\u1EC3 x\xE1c nh\u1EADn." });
        return;
      }
      const clientIp = req.ip || "unknown";
      const limitKey = `admin-cred:${clientIp}:${actor.id}`;
      const rate = authRateLimiter.check(limitKey);
      if (!rate.allowed) {
        res.status(429).json({
          error: `Th\u1EED sai qu\xE1 nhi\u1EC1u l\u1EA7n. Vui l\xF2ng th\u1EED l\u1EA1i sau ${rate.retryAfterSeconds} gi\xE2y.`
        });
        return;
      }
      const actorRow = await getUserById(actor.id);
      if (!actorRow) {
        res.status(401).json({ error: "Kh\xF4ng t\xECm th\u1EA5y phi\xEAn qu\u1EA3n tr\u1ECB." });
        return;
      }
      const passwordOk = await verifyPassword(adminPassword, actorRow.password_hash);
      if (!passwordOk) {
        authRateLimiter.recordFailure(limitKey);
        res.status(401).json({ error: "M\u1EADt kh\u1EA9u x\xE1c nh\u1EADn kh\xF4ng ch\xEDnh x\xE1c." });
        return;
      }
      authRateLimiter.clear(limitKey);
      const decryptedPassword = target.password_encrypted ? decryptSecret(target.password_encrypted) : null;
      let twoFactorInfo = {
        enabled: Boolean(target.two_factor_enabled),
        currentCode: null,
        remainingSeconds: 30 - Math.floor(Date.now() / 1e3) % 30,
        secret: null,
        qrDataUrl: null
      };
      if (Boolean(target.two_factor_enabled) && target.two_factor_secret) {
        const plain2fa = decryptSecret(target.two_factor_secret);
        if (plain2fa) {
          const uri = buildOtpAuthUri({
            issuer: "V\xED Ti\u1EBFt Ki\u1EC7m C\xE1 Nh\xE2n",
            accountName: target.username,
            secret: plain2fa
          });
          const qrDataUrl = await generateQrDataUrl(uri);
          twoFactorInfo = {
            enabled: true,
            currentCode: generateTotpCode(plain2fa),
            remainingSeconds: 30 - Math.floor(Date.now() / 1e3) % 30,
            secret: plain2fa,
            qrDataUrl
          };
        }
      }
      res.json({
        user: {
          id: target.id,
          username: target.username,
          displayName: target.display_name,
          role: target.role === "admin" ? "admin" : "user",
          isRootAdmin: Boolean(target.is_root_admin),
          twoFactorEnabled: Boolean(target.two_factor_enabled)
        },
        password: decryptedPassword,
        passwordStatus: decryptedPassword ? "available" : "scrypt_only",
        twoFactor: twoFactorInfo
      });
    } catch (err) {
      next(err);
    }
  });
  app.post("/api/admin/users/:id/disable-2fa", requireAuth, requireAdmin, async (req, res, next) => {
    try {
      const actor = req.authUser;
      const target = await getUserById(req.params.id);
      if (!target) {
        res.status(404).json({ error: "Kh\xF4ng t\xECm th\u1EA5y t\xE0i kho\u1EA3n." });
        return;
      }
      if (target.is_root_admin && !actor.isRootAdmin) {
        res.status(403).json({
          error: "Admin ph\u1EE5 kh\xF4ng th\u1EC3 t\u1EAFt x\xE1c minh 2 b\u01B0\u1EDBc c\u1EE7a Qu\u1EA3n tr\u1ECB g\u1ED1c."
        });
        return;
      }
      const nextSv = Number(target.session_version ?? 1) + 1;
      await dbExecute(
        `UPDATE app_users
         SET two_factor_enabled = 0, two_factor_secret = '', two_factor_pending_secret = '', session_version = ?, updated_at = ?
         WHERE id = ?`,
        [nextSv, (/* @__PURE__ */ new Date()).toISOString(), target.id]
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
  app.delete("/api/admin/users/:id", requireAuth, requireAdmin, async (req, res, next) => {
    try {
      const actor = req.authUser;
      const target = await getUserById(req.params.id);
      if (!target) {
        res.status(404).json({ error: "Kh\xF4ng t\xECm th\u1EA5y t\xE0i kho\u1EA3n." });
        return;
      }
      if (target.is_root_admin) {
        res.status(403).json({ error: "Kh\xF4ng th\u1EC3 x\xF3a t\xE0i kho\u1EA3n Qu\u1EA3n tr\u1ECB g\u1ED1c." });
        return;
      }
      const deleteDecision = checkAdminSelfAction({
        actorId: actor.id,
        targetId: target.id,
        action: "delete"
      });
      if (!deleteDecision.allowed) {
        res.status(deleteDecision.status).json({ error: deleteDecision.error });
        return;
      }
      await dbPipeline([
        { sql: "DELETE FROM user_transactions WHERE user_id = ?", args: [target.id] },
        { sql: "DELETE FROM user_goals WHERE user_id = ?", args: [target.id] },
        { sql: "DELETE FROM user_chat_messages WHERE user_id = ?", args: [target.id] },
        { sql: "DELETE FROM user_security_alerts WHERE owner_user_id = ?", args: [target.id] },
        { sql: "DELETE FROM app_users WHERE id = ?", args: [target.id] }
      ]);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });
  app.get("/api/admin/ai-settings", requireAuth, requireAdmin, async (_req, res, next) => {
    try {
      const s = await getAiSettings();
      const loginSocialLinks = parseStoredNoticeLinks(
        s.login_social_links,
        s.login_discord_url,
        s.login_discord_label
      );
      res.json({
        settings: {
          provider: s.provider || "server_default",
          hasApiKey: Boolean(s.api_key && s.api_key.trim().length > 0),
          baseUrl: s.base_url || "",
          chatModel: s.chat_model || "gemini-4-hydrogen",
          visionModel: s.vision_model || "auto",
          loginNoticeEnabled: s.login_notice_enabled !== 0,
          loginNoticeTone: normalizeNoticeTone(s.login_notice_tone),
          loginNoticeBadge: s.login_notice_badge || "Th\xF4ng b\xE1o",
          loginNoticeTitle: s.login_notice_title || "",
          loginNoticeText: s.login_notice_text || "",
          loginSocialLinks,
          updatedAt: s.updated_at
        }
      });
    } catch (err) {
      next(err);
    }
  });
  app.put("/api/admin/ai-settings", requireAuth, requireAdmin, async (req, res, next) => {
    try {
      const current = await getAiSettings();
      const body = req.body;
      const allowedProviders = [
        "server_default",
        "openai_compatible",
        "gemini",
        "openai",
        "anthropic"
      ];
      const provider = allowedProviders.includes(body.provider) ? body.provider : current.provider;
      let baseUrl = typeof body.baseUrl === "string" ? body.baseUrl.trim() : current.base_url;
      if (provider === "openai_compatible" && baseUrl) {
        baseUrl = assertSafeExternalUrl(baseUrl);
      } else if (provider === "anthropic" && baseUrl) {
        baseUrl = assertSafeExternalUrl(baseUrl);
      }
      let apiKey = current.api_key;
      if (body.clearApiKey) {
        apiKey = "";
      } else if (typeof body.apiKey === "string" && body.apiKey.trim()) {
        apiKey = body.apiKey.trim();
      }
      const chatModel = typeof body.chatModel === "string" && body.chatModel.trim() ? body.chatModel.trim().slice(0, 120) : current.chat_model;
      const visionModel = typeof body.visionModel === "string" && body.visionModel.trim() ? body.visionModel.trim().slice(0, 120) : "auto";
      const loginNoticeEnabled = typeof body.loginNoticeEnabled === "boolean" ? body.loginNoticeEnabled : current.login_notice_enabled !== 0;
      const loginNoticeTone = typeof body.loginNoticeTone === "string" ? normalizeNoticeTone(body.loginNoticeTone) : normalizeNoticeTone(current.login_notice_tone);
      const loginNoticeBadge = typeof body.loginNoticeBadge === "string" ? body.loginNoticeBadge.trim().slice(0, 40) : current.login_notice_badge;
      const loginNoticeTitle = typeof body.loginNoticeTitle === "string" ? body.loginNoticeTitle.trim().slice(0, 120) : current.login_notice_title;
      const loginNoticeText = typeof body.loginNoticeText === "string" ? body.loginNoticeText.trim().slice(0, 1e3) : current.login_notice_text;
      let loginSocialLinks = parseStoredNoticeLinks(
        current.login_social_links,
        current.login_discord_url,
        current.login_discord_label
      );
      if (body.loginSocialLinks !== void 0) {
        if (!Array.isArray(body.loginSocialLinks)) {
          res.status(400).json({ error: "Danh s\xE1ch li\xEAn k\u1EBFt m\u1EA1ng x\xE3 h\u1ED9i kh\xF4ng h\u1EE3p l\u1EC7." });
          return;
        }
        for (const item of body.loginSocialLinks) {
          if (item && typeof item === "object" && typeof item.url === "string") {
            const rawUrl = String(item.url).trim();
            if (rawUrl && !isValidSafeHttpUrl(rawUrl)) {
              res.status(400).json({ error: "T\u1EA5t c\u1EA3 li\xEAn k\u1EBFt m\u1EA1ng x\xE3 h\u1ED9i ph\u1EA3i b\u1EAFt \u0111\u1EA7u b\u1EB1ng https:// ho\u1EB7c http://." });
              return;
            }
          }
        }
        loginSocialLinks = sanitizeNoticeLinks(body.loginSocialLinks);
      }
      const encryptedApiKeyToStore = apiKey ? isEncryptedSecret(apiKey) ? apiKey : encryptSecret(apiKey) : "";
      const firstDiscord = loginSocialLinks.find((l) => l.platform === "discord");
      const now = (/* @__PURE__ */ new Date()).toISOString();
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
          firstDiscord?.url || "",
          firstDiscord?.label || "",
          JSON.stringify(loginSocialLinks),
          now
        ]
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
          updatedAt: now
        }
      });
    } catch (err) {
      res.status(400).json({
        error: sanitizePublicError(err, "Kh\xF4ng th\u1EC3 l\u01B0u c\u1EA5u h\xECnh AI.")
      });
    }
  });
  app.post("/api/admin/ai-models", requireAuth, requireAdmin, async (req, res) => {
    try {
      const current = await getAiSettings();
      const { provider, apiKey, baseUrl } = req.body;
      const effectiveProvider = provider || current.provider;
      const effectiveKey = typeof apiKey === "string" && apiKey.trim() ? apiKey.trim() : current.api_key;
      const effectiveBaseUrl = typeof baseUrl === "string" && baseUrl.trim() ? baseUrl.trim() : current.base_url;
      const models = await listProviderModels({
        provider: effectiveProvider,
        apiKey: effectiveKey,
        baseUrl: effectiveBaseUrl
      });
      res.json({ models });
    } catch (err) {
      res.status(400).json({
        error: sanitizePublicError(err, "Kh\xF4ng th\u1EC3 l\u1EA5y danh s\xE1ch model.")
      });
    }
  });
  app.post("/api/admin/ai-test", requireAuth, requireAdmin, async (req, res) => {
    try {
      const current = await getAiSettings();
      const body = req.body;
      const effectiveProvider = body.provider || current.provider;
      const effectiveBaseUrl = typeof body.baseUrl === "string" && body.baseUrl.trim() ? assertSafeExternalUrl(body.baseUrl) : current.base_url;
      const effectiveKey = body.clearApiKey ? "" : typeof body.apiKey === "string" && body.apiKey.trim() ? body.apiKey.trim() : current.api_key;
      const effectiveChatModel = typeof body.chatModel === "string" && body.chatModel.trim() ? body.chatModel.trim().slice(0, 120) : current.chat_model;
      const result = await testAiConnection({
        ...current,
        provider: effectiveProvider,
        api_key: effectiveKey,
        base_url: effectiveBaseUrl,
        chat_model: effectiveChatModel
      });
      res.json(result);
    } catch (err) {
      res.status(400).json({
        error: sanitizePublicError(err, "Ki\u1EC3m tra k\u1EBFt n\u1ED1i AI th\u1EA5t b\u1EA1i.")
      });
    }
  });
  app.use("/api", (err, _req, res, _next) => {
    console.error("[API Error]", err);
    res.status(500).json({
      error: sanitizePublicError(err, "H\u1EC7 th\u1ED1ng \u0111ang b\u1EADn ho\u1EB7c t\u1EA1m gi\xE1n \u0111o\u1EA1n. Vui l\xF2ng th\u1EED l\u1EA1i sau.")
    });
  });
  const isProd = process.env.NODE_ENV === "production";
  if (!isProd) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), "dist");
    app.use(express.static(distDir));
    app.get("*", (_req, res) => {
      const indexFile = path.join(distDir, "index.html");
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send("Not found");
      }
    });
  }
  const port = Number(process.env.PORT) || 3e3;
  app.listen(port, "0.0.0.0", () => {
    console.log(`V\xED Ti\u1EBFt Ki\u1EC7m C\xE1 Nh\xE2n listening on http://0.0.0.0:${port}`);
  });
}
startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
