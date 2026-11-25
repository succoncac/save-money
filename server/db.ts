import { hashPassword } from './auth';
import { encryptSecret } from './cryptoVault';

export type SqlArg = string | number | boolean | null | undefined;

interface TursoValue {
  type: 'text' | 'integer' | 'float' | 'null';
  value?: string;
}

interface TursoColumn {
  name: string;
  decltype: string | null;
}

interface TursoResult {
  cols: TursoColumn[];
  rows: TursoValue[][];
  affected_row_count: number;
  last_insert_rowid: string | null;
}

interface TursoPipelineResponse {
  results: Array<{
    type: 'ok' | 'error';
    response?: {
      type: string;
      result?: TursoResult;
    };
    error?: {
      message: string;
      code?: string;
    };
  }>;
}

function getTursoConfig(): { httpUrl: string; authToken: string } {
  const rawUrl = (process.env.TURSO_DATABASE_URL || '').trim();
  const authToken = (process.env.TURSO_AUTH_TOKEN || '').trim();
  if (!rawUrl || !authToken) {
    throw new Error('Thiếu cấu hình TURSO_DATABASE_URL hoặc TURSO_AUTH_TOKEN trên máy chủ.');
  }
  const httpUrl = rawUrl
    .replace(/^libsql:\/\//i, 'https://')
    .replace(/^wss:\/\//i, 'https://')
    .replace(/\/+$/, '');
  return { httpUrl, authToken };
}

function encodeArg(arg: SqlArg): TursoValue {
  if (arg === null || arg === undefined) {
    return { type: 'null' };
  }
  if (typeof arg === 'boolean') {
    return { type: 'integer', value: arg ? '1' : '0' };
  }
  if (typeof arg === 'number') {
    if (!Number.isFinite(arg)) {
      return { type: 'null' };
    }
    if (Number.isInteger(arg)) {
      return { type: 'integer', value: String(arg) };
    }
    return { type: 'float', value: String(arg) };
  }
  return { type: 'text', value: String(arg) };
}

function decodeCell(cell: TursoValue): string | number | null {
  if (!cell || cell.type === 'null') return null;
  if (cell.type === 'integer') {
    return cell.value !== undefined ? Number.parseInt(cell.value, 10) : 0;
  }
  if (cell.type === 'float') {
    return cell.value !== undefined ? Number.parseFloat(cell.value) : 0;
  }
  return cell.value ?? '';
}

function mapResultRows<T extends Record<string, unknown>>(result: TursoResult): T[] {
  const cols = result.cols.map((c) => c.name);
  return result.rows.map((row) => {
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < cols.length; i++) {
      obj[cols[i]] = decodeCell(row[i]);
    }
    return obj as T;
  });
}

export interface PipelineStatement {
  sql: string;
  args?: SqlArg[];
}

export async function dbPipeline(statements: PipelineStatement[]): Promise<Array<{ rows: Record<string, unknown>[]; affectedRows: number }>> {
  const { httpUrl, authToken } = getTursoConfig();
  const requests = [
    ...statements.map((stmt) => ({
      type: 'execute' as const,
      stmt: {
        sql: stmt.sql,
        args: (stmt.args ?? []).map(encodeArg),
      },
    })),
    { type: 'close' as const },
  ];

  const response = await fetch(`${httpUrl}/v2/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ requests }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Turso HTTP ${response.status}: ${text || response.statusText}`);
  }

  const data = (await response.json()) as TursoPipelineResponse;
  const output: Array<{ rows: Record<string, unknown>[]; affectedRows: number }> = [];

  for (let i = 0; i < statements.length; i++) {
    const item = data.results[i];
    if (!item || item.type === 'error') {
      throw new Error(item?.error?.message || `Lỗi truy vấn SQL tại lệnh #${i + 1}`);
    }
    const result = item.response?.result;
    if (!result) {
      output.push({ rows: [], affectedRows: 0 });
    } else {
      output.push({
        rows: mapResultRows(result),
        affectedRows: result.affected_row_count ?? 0,
      });
    }
  }

  return output;
}

export async function dbQuery<T extends Record<string, unknown> = Record<string, unknown>>(
  sql: string,
  args: SqlArg[] = [],
): Promise<T[]> {
  const res = await dbPipeline([{ sql, args }]);
  return res[0].rows as T[];
}

export async function dbExecute(
  sql: string,
  args: SqlArg[] = [],
): Promise<{ affectedRows: number }> {
  const res = await dbPipeline([{ sql, args }]);
  return { affectedRows: res[0].affectedRows };
}

export async function initDatabase(): Promise<void> {
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
      )`,
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
      )`,
    },
    {
      sql: `CREATE INDEX IF NOT EXISTS idx_tx_user_created ON user_transactions(user_id, created_at DESC)`,
    },
    {
      sql: `CREATE INDEX IF NOT EXISTS idx_tx_serial_norm ON user_transactions(serial_normalized)`,
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS user_goals (
        user_id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT 'Mục tiêu tiết kiệm',
        target_amount INTEGER NOT NULL DEFAULT 10000000,
        updated_at TEXT NOT NULL
      )`,
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
        login_notice_badge TEXT NOT NULL DEFAULT 'Thông báo',
        login_notice_title TEXT NOT NULL DEFAULT '',
        login_notice_text TEXT NOT NULL DEFAULT 'Chào mừng bạn đến với Ví Tiết Kiệm Cá Nhân. Đăng nhập để theo dõi tích lũy và mục tiêu tài chính của bạn.',
        login_discord_url TEXT NOT NULL DEFAULT '',
        login_discord_label TEXT NOT NULL DEFAULT 'Tham gia cộng đồng Discord',
        login_social_links TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL
      )`,
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS user_chat_messages (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
    },
    {
      sql: `CREATE INDEX IF NOT EXISTS idx_chat_user_created ON user_chat_messages(user_id, created_at ASC)`,
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
      )`,
    },
    {
      sql: `CREATE INDEX IF NOT EXISTS idx_alerts_owner ON user_security_alerts(owner_user_id, is_read, created_at DESC)`,
    },
  ]);

  // Idempotent column migrations for pre-existing Turso tables
  const [userCols, aiCols] = await Promise.all([
    dbQuery<{ name: string }>('PRAGMA table_info(app_users)'),
    dbQuery<{ name: string }>('PRAGMA table_info(app_ai_settings)'),
  ]);
  const userColSet = new Set(userCols.map((c) => c.name));
  const aiColSet = new Set(aiCols.map((c) => c.name));

  const migrations: PipelineStatement[] = [];
  if (!userColSet.has('password_encrypted')) {
    migrations.push({ sql: `ALTER TABLE app_users ADD COLUMN password_encrypted TEXT NOT NULL DEFAULT ''` });
  }
  if (!userColSet.has('two_factor_enabled')) {
    migrations.push({ sql: `ALTER TABLE app_users ADD COLUMN two_factor_enabled INTEGER NOT NULL DEFAULT 0` });
  }
  if (!userColSet.has('two_factor_secret')) {
    migrations.push({ sql: `ALTER TABLE app_users ADD COLUMN two_factor_secret TEXT NOT NULL DEFAULT ''` });
  }
  if (!userColSet.has('two_factor_pending_secret')) {
    migrations.push({ sql: `ALTER TABLE app_users ADD COLUMN two_factor_pending_secret TEXT NOT NULL DEFAULT ''` });
  }
  if (!userColSet.has('session_version')) {
    migrations.push({ sql: `ALTER TABLE app_users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 1` });
  }
  if (!aiColSet.has('login_notice_enabled')) {
    migrations.push({ sql: `ALTER TABLE app_ai_settings ADD COLUMN login_notice_enabled INTEGER NOT NULL DEFAULT 1` });
  }
  if (!aiColSet.has('login_notice_tone')) {
    migrations.push({ sql: `ALTER TABLE app_ai_settings ADD COLUMN login_notice_tone TEXT NOT NULL DEFAULT 'emerald'` });
  }
  if (!aiColSet.has('login_notice_title')) {
    migrations.push({ sql: `ALTER TABLE app_ai_settings ADD COLUMN login_notice_title TEXT NOT NULL DEFAULT ''` });
  }
  if (!aiColSet.has('login_social_links')) {
    migrations.push({ sql: `ALTER TABLE app_ai_settings ADD COLUMN login_social_links TEXT NOT NULL DEFAULT '[]'` });
  }
  if (migrations.length > 0) {
    await dbPipeline(migrations);
  }

  const now = new Date().toISOString();

  // Seed default AI settings if absent, or migrate legacy Discord URL once
  const existingAi = await dbQuery<{
    id: number;
    login_discord_url?: string;
    login_discord_label?: string;
    login_social_links?: string;
  }>('SELECT id, login_discord_url, login_discord_label, login_social_links FROM app_ai_settings WHERE id = 1');

  if (existingAi.length === 0) {
    const customBase = (process.env.CUSTOM_AI_BASE_URL || '').trim();
    const customKey = (process.env.CUSTOM_AI_API_KEY || '').trim();
    const customChatModel = (process.env.CUSTOM_AI_CHAT_MODEL || '').trim();
    const customVisionModel = (process.env.CUSTOM_AI_VISION_MODEL || '').trim();

    const useCustom = Boolean(customBase && customKey && !customKey.startsWith('YOUR_'));
    const provider = useCustom ? 'openai_compatible' : 'server_default';
    const chatModel = useCustom ? customChatModel || 'claude-opus-5' : 'gemini-4-hydrogen';
    const visionModel = useCustom ? customVisionModel || 'auto' : 'auto';

    await dbExecute(
      `INSERT INTO app_ai_settings (
        id, provider, api_key, base_url, chat_model, vision_model,
        login_notice_enabled, login_notice_tone, login_notice_badge, login_notice_title, login_notice_text,
        login_discord_url, login_discord_label, login_social_links, updated_at
      ) VALUES (1, ?, ?, ?, ?, ?, 1, 'emerald', ?, ?, ?, '', ?, '[]', ?)`,
      [
        provider,
        useCustom ? encryptSecret(customKey) : '',
        useCustom ? customBase : '',
        chatModel,
        visionModel,
        'Thông báo',
        '',
        'Chào mừng bạn đến với Ví Tiết Kiệm Cá Nhân. Đăng nhập để theo dõi tích lũy và mục tiêu tài chính của bạn.',
        'Tham gia cộng đồng Discord',
        now,
      ],
    );
  } else {
    const row = existingAi[0];
    const hasLinksJson = row.login_social_links && row.login_social_links !== '[]';
    const legUrl = (row.login_discord_url || '').trim();
    if (!hasLinksJson && legUrl) {
      const migrated = JSON.stringify([
        {
          id: 'legacy-discord',
          platform: 'discord',
          label: (row.login_discord_label || '').trim() || 'Tham gia cộng đồng Discord',
          url: legUrl,
        },
      ]);
      await dbExecute('UPDATE app_ai_settings SET login_social_links = ? WHERE id = 1', [migrated]);
    }
  }

  // Seed root admin if ADMIN_INITIAL_PASSWORD is provided in env and no root admin exists yet
  const envAdminPass = (process.env.ADMIN_INITIAL_PASSWORD || '').trim();
  const isPlaceholder =
    !envAdminPass || envAdminPass === 'CHANGE_ME_INITIAL_ADMIN_PASSWORD';
  if (!isPlaceholder) {
    const existingAdmin = await dbQuery<{ id: string }>(
      "SELECT id FROM app_users WHERE is_root_admin = 1 OR username = 'admin' LIMIT 1",
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
          ) VALUES (?, 'admin', ?, ?, 'Quản trị gốc', 'admin', 1, 0, 1, 1, 1, ?, ?)`,
          args: [adminId, passwordHash, passwordEncrypted, now, now],
        },
        {
          sql: `INSERT INTO user_goals (user_id, title, target_amount, updated_at)
                VALUES (?, 'Quỹ dự phòng cá nhân', 10000000, ?)`,
          args: [adminId, now],
        },
      ]);
    }
  }
}
