import { GoogleGenAI, Type } from '@google/genai';
import net from 'node:net';
import { dbQuery } from './db';
import { decryptSecret, isEncryptedSecret } from './cryptoVault';
import { VND_DENOMINATIONS } from '../src/utils/currency';
import { normalizeSerial } from '../src/utils/serial';
import type { AiProvider, BillScanResult } from '../src/types';

export interface DbAiSettingsRow extends Record<string, unknown> {
  id: number;
  provider: string;
  api_key: string;
  base_url: string;
  chat_model: string;
  vision_model: string;
  login_notice_enabled: number;
  login_notice_tone: string;
  login_notice_badge: string;
  login_notice_title: string;
  login_notice_text: string;
  login_discord_url: string;
  login_discord_label: string;
  login_social_links: string;
  updated_at: string;
}

export async function getAiSettings(): Promise<DbAiSettingsRow> {
  const rows = await dbQuery<DbAiSettingsRow>('SELECT * FROM app_ai_settings WHERE id = 1 LIMIT 1');
  if (rows[0]) {
    const row = rows[0];
    const rawKey = (row.api_key || '').trim();
    const decryptedKey = rawKey
      ? isEncryptedSecret(rawKey)
        ? (decryptSecret(rawKey) ?? '')
        : rawKey
      : '';
    return {
      ...row,
      api_key: decryptedKey,
    };
  }
  return {
    id: 1,
    provider: 'server_default',
    api_key: '',
    base_url: '',
    chat_model: 'gemini-4-hydrogen',
    vision_model: 'auto',
    login_notice_enabled: 1,
    login_notice_tone: 'emerald',
    login_notice_badge: 'Thông báo',
    login_notice_title: '',
    login_notice_text: '',
    login_discord_url: '',
    login_discord_label: 'Tham gia cộng đồng Discord',
    login_social_links: '[]',
    updated_at: new Date().toISOString(),
  };
}

function isPrivateIp(host: string): boolean {
  const ipType = net.isIP(host);
  if (ipType === 4) {
    const parts = host.split('.').map(Number);
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
    return lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80');
  }
  return false;
}

export function assertSafeExternalUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim().replace(/\/+$/, '');
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Base URL không đúng định dạng URL.');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Base URL chỉ chấp nhận giao thức http hoặc https.');
  }
  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    isPrivateIp(hostname)
  ) {
    throw new Error('Base URL không được trỏ tới địa chỉ nội bộ hoặc loopback.');
  }
  return trimmed;
}

class RetryableAiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      const status =
        err instanceof RetryableAiError
          ? err.status
          : /503|overloaded|unavailable|429|resource_exhausted/i.test(msg)
            ? 503
            : 0;
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

function getGeminiClient(apiKey: string): GoogleGenAI {
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function resolveVisionModelCandidates(provider: AiProvider, settings: DbAiSettingsRow): string[] {
  const configured = (settings.vision_model || '').trim();
  if (configured && configured.toLowerCase() !== 'auto') {
    return [configured];
  }
  // Auto mode picks ordered vision-capable models per provider with automatic fallback
  if (provider === 'server_default' || provider === 'gemini') {
    return ['gemini-4-hydrogen', 'gemini-4-neon'];
  }
  if (provider === 'anthropic') {
    const primary =
      settings.chat_model && settings.chat_model.includes('claude')
        ? settings.chat_model
        : 'claude-opus-5';
    return [primary];
  }
  if (provider === 'openai') {
    return ['gpt-4o', 'gpt-4o-mini'];
  }
  // openai_compatible
  const chat = (settings.chat_model || '').trim();
  if (chat) return [chat];
  return ['claude-opus-5'];
}

function resolveChatModel(provider: AiProvider, settings: DbAiSettingsRow): string {
  const configured = (settings.chat_model || '').trim();
  if (configured) return configured;
  if (provider === 'server_default' || provider === 'gemini') return 'gemini-4-hydrogen';
  if (provider === 'anthropic') return 'claude-opus-5';
  if (provider === 'openai') return 'gpt-4o-mini';
  return 'claude-opus-5';
}

function parseDataUrl(imageDataUrl: string): { mimeType: string; base64: string } {
  const match = /^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=\s]+)$/i.exec(
    imageDataUrl.trim(),
  );
  if (!match) {
    throw new Error('Định dạng ảnh không hợp lệ (hỗ trợ PNG, JPEG, WebP).');
  }
  const mimeType = match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase();
  const base64 = match[2].replace(/\s+/g, '');
  if (base64.length > 7_000_000) {
    throw new Error('Ảnh quá lớn. Vui lòng chọn ảnh dưới 5MB.');
  }
  return { mimeType, base64 };
}

export function extractJsonObject(rawText: string): Record<string, unknown> {
  const trimmed = rawText.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');
  const jsonStr =
    firstBrace >= 0 && lastBrace > firstBrace
      ? candidate.slice(firstBrace, lastBrace + 1)
      : candidate;
  try {
    const parsed = JSON.parse(jsonStr) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Dữ liệu JSON không hợp lệ.');
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error('AI trả về dữ liệu không đúng định dạng JSON. Vui lòng chụp ảnh rõ nét hơn hoặc thử lại.');
  }
}

function normalizeScanOutput(parsed: Record<string, unknown>): BillScanResult {
  const rawDenom = typeof parsed.denomination === 'number' ? Math.trunc(parsed.denomination) : null;
  const validDenom =
    rawDenom && (VND_DENOMINATIONS as readonly number[]).includes(rawDenom) ? rawDenom : null;

  const rawSerial =
    typeof parsed.serialNumber === 'string' && parsed.serialNumber.trim().length > 0
      ? parsed.serialNumber.trim().slice(0, 40)
      : null;
  const serialNormalized = rawSerial ? normalizeSerial(rawSerial) || null : null;

  let confidence = 0;
  if (typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence)) {
    confidence = Math.min(1, Math.max(0, parsed.confidence));
  }

  const note =
    typeof parsed.note === 'string' && parsed.note.trim().length > 0
      ? parsed.note.trim().slice(0, 200)
      : validDenom
        ? `Nhận diện tờ ${validDenom.toLocaleString('vi-VN')} ₫`
        : 'Không nhận diện rõ mệnh giá tờ tiền VNĐ trong ảnh.';

  return {
    denomination: validDenom,
    serialNumber: rawSerial,
    serialNormalized,
    confidence,
    note,
  };
}

export async function scanBillWithAi(
  settings: DbAiSettingsRow,
  imageDataUrl: string,
): Promise<BillScanResult> {
  const { mimeType, base64 } = parseDataUrl(imageDataUrl);
  const provider = (settings.provider || 'server_default') as AiProvider;
  const modelCandidates = resolveVisionModelCandidates(provider, settings);

  const systemPrompt =
    'Bạn là hệ thống OCR tiền giấy/polymer Việt Nam (VNĐ). Hãy quan sát ảnh và trích xuất chính xác:\n' +
    '1. denomination: số nguyên mệnh giá VNĐ thuộc [500000, 200000, 100000, 50000, 20000, 10000, 5000, 2000, 1000] hoặc null nếu không phải tờ tiền VNĐ.\n' +
    '2. serialNumber: chuỗi số seri in trên tờ tiền (ví dụ "AB 12345678"), hoặc null nếu bị che/mờ không đọc được.\n' +
    '3. confidence: độ tin cậy từ 0 đến 1.\n' +
    '4. note: ghi chú ngắn bằng tiếng Việt.\n' +
    'Chỉ trả về JSON thuần túy với các khóa denomination, serialNumber, confidence, note.';

  const scanWithModel = (model: string): Promise<BillScanResult> =>
    withRetry(async () => {
      if (provider === 'server_default' || provider === 'gemini') {
      const apiKey =
        provider === 'gemini'
          ? (settings.api_key || '').trim() || (process.env.GEMINI_API_KEY || '').trim()
          : (process.env.GEMINI_API_KEY || '').trim();
      if (!apiKey) {
        throw new Error('Chưa cấu hình GEMINI_API_KEY trên máy chủ.');
      }
      const ai = getGeminiClient(apiKey);
      const response = await ai.models.generateContent({
        model,
        contents: {
          parts: [
            { inlineData: { mimeType, data: base64 } },
            { text: 'Hãy nhận diện mệnh giá và số seri tờ tiền VNĐ trong ảnh này.' },
          ],
        },
        config: {
          systemInstruction: systemPrompt,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              denomination: { type: Type.INTEGER, nullable: true },
              serialNumber: { type: Type.STRING, nullable: true },
              confidence: { type: Type.NUMBER },
              note: { type: Type.STRING },
            },
          },
        },
      });
      const parsed = extractJsonObject(response.text || '{}');
      return normalizeScanOutput(parsed);
    }

    if (provider === 'anthropic') {
      const apiKey = (settings.api_key || '').trim();
      if (!apiKey) throw new Error('Chưa cấu hình API Key cho Anthropic.');
      const baseUrl = settings.base_url
        ? assertSafeExternalUrl(settings.base_url)
        : 'https://api.anthropic.com/v1';

      const res = await fetch(`${baseUrl}/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          max_tokens: 400,
          system: systemPrompt,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: { type: 'base64', media_type: mimeType, data: base64 },
                },
                { type: 'text', text: 'Trích xuất JSON mệnh giá và số seri tờ tiền VNĐ.' },
              ],
            },
          ],
        }),
        signal: AbortSignal.timeout(25000),
      });
      if (res.status === 503 || res.status === 429) {
        throw new RetryableAiError(`Dịch vụ AI đang quá tải (${res.status}).`, res.status);
      }
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        throw new Error(`Lỗi Anthropic (${res.status}): ${errBody.slice(0, 200)}`);
      }
      const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
      const text = data.content?.find((c) => c.type === 'text')?.text || '{}';
      return normalizeScanOutput(extractJsonObject(text));
    }

    // openai or openai_compatible
    const apiKey = (settings.api_key || '').trim();
    if (!apiKey) throw new Error('Chưa cấu hình API Key cho nhà cung cấp AI.');
    const baseUrl =
      provider === 'openai'
        ? 'https://api.openai.com/v1'
        : assertSafeExternalUrl(settings.base_url || '');

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_tokens: 400,
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Hãy trích xuất JSON mệnh giá và số seri tờ tiền VNĐ trong ảnh.' },
              { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(25000),
    });

    if (res.status === 503 || res.status === 429) {
      throw new RetryableAiError(`Dịch vụ AI đang quá tải (${res.status}).`, res.status);
    }
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`Lỗi AI (${res.status}): ${errBody.slice(0, 220)}`);
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data.choices?.[0]?.message?.content || '{}';
    return normalizeScanOutput(extractJsonObject(text));
  });

  let lastErr: unknown;
  for (const model of modelCandidates) {
    try {
      return await scanWithModel(model);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error('Không thể phân tích ảnh tờ tiền lúc này.');
}

export async function advisorChatWithAi(
  settings: DbAiSettingsRow,
  financialContext: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  userMessage: string,
): Promise<string> {
  const provider = (settings.provider || 'server_default') as AiProvider;
  const model = resolveChatModel(provider, settings);

  const systemInstruction =
    'Bạn là Trợ lý Tài chính Cá nhân thông minh và tinh tế cho ứng dụng "Ví Tiết Kiệm Cá Nhân" (tiền tệ VNĐ).\n' +
    'QUY TẮC BẮT BUỘC:\n' +
    '1. Chỉ trả lời các chủ đề liên quan đến quản lý tài chính cá nhân, tiết kiệm, lập ngân sách, mục tiêu tích lũy bằng VNĐ và phân tích số liệu ví của người dùng.\n' +
    '2. Nếu người dùng hỏi ngoài phạm vi tài chính cá nhân (lập trình, chính trị, giải trí, viết code...), hãy lịch sự từ chối và hướng họ quay lại câu chuyện tiết kiệm VNĐ.\n' +
    '3. Trả lời bằng tiếng Việt tự nhiên, mạch lạc, thân thiện như một cố vấn tài chính thực thụ (không quá thô sơ hay cứng nhắc), có số liệu cụ thể dựa trên dữ liệu ví hiện tại (không bịa đặt số liệu).\n' +
    '4. ĐỊNH DẠNG VĂN BẢN:\n' +
    '   - Trò chuyện bình thường bằng các đoạn văn rõ ràng, xuống dòng thoáng; không dùng ký tự dấu thăng (#) làm tiêu đề, không rải dấu sao (*) bừa bãi trong câu, dùng dấu gạch đầu dòng (-) hoặc số thứ tự (1., 2.) khi cần liệt kê, và dùng dấu "×" cho phép nhân thay vì "*".\n' +
    '   - Khi cần trình bày bảng kế hoạch tiết kiệm, bảng phân bổ ngân sách, bảng so sánh phương án hoặc lịch tích lũy nhiều mốc số liệu, hãy kẻ bảng Markdown chuẩn (ví dụ: | Hạng mục | Số tiền (VNĐ) | Ghi chú | kèm dòng phân cách |---|---:|---|) để giao diện hiển thị thành bảng kẻ ô rõ ràng.\n\n' +
    `DỮ LIỆU VÍ HIỆN TẠI CỦA NGƯỜI DÙNG:\n${financialContext}`;

  return withRetry(async () => {
    if (provider === 'server_default' || provider === 'gemini') {
      const apiKey =
        provider === 'gemini'
          ? (settings.api_key || '').trim() || (process.env.GEMINI_API_KEY || '').trim()
          : (process.env.GEMINI_API_KEY || '').trim();
      if (!apiKey) {
        throw new Error('Chưa cấu hình GEMINI_API_KEY trên máy chủ.');
      }
      const ai = getGeminiClient(apiKey);
      const contents = [
        ...history.slice(-10).map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        })),
        { role: 'user', parts: [{ text: userMessage }] },
      ];
      const response = await ai.models.generateContent({
        model,
        contents,
        config: { systemInstruction },
      });
      return (response.text || '').trim() || 'Xin lỗi, tôi chưa thể tạo phản hồi lúc này.';
    }

    if (provider === 'anthropic') {
      const apiKey = (settings.api_key || '').trim();
      if (!apiKey) throw new Error('Chưa cấu hình API Key cho Anthropic.');
      const baseUrl = settings.base_url
        ? assertSafeExternalUrl(settings.base_url)
        : 'https://api.anthropic.com/v1';
      const res = await fetch(`${baseUrl}/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          max_tokens: 900,
          system: systemInstruction,
          messages: [
            ...history.slice(-10).map((m) => ({ role: m.role, content: m.content })),
            { role: 'user', content: userMessage },
          ],
        }),
        signal: AbortSignal.timeout(25000),
      });
      if (res.status === 503 || res.status === 429) {
        throw new RetryableAiError(`Dịch vụ AI đang quá tải (${res.status}).`, res.status);
      }
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        throw new Error(`Lỗi Anthropic (${res.status}): ${errBody.slice(0, 200)}`);
      }
      const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
      return data.content?.find((c) => c.type === 'text')?.text?.trim() || 'Không có phản hồi.';
    }

    // openai or openai_compatible
    const apiKey = (settings.api_key || '').trim();
    if (!apiKey) throw new Error('Chưa cấu hình API Key cho nhà cung cấp AI.');
    const baseUrl =
      provider === 'openai'
        ? 'https://api.openai.com/v1'
        : assertSafeExternalUrl(settings.base_url || '');

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 900,
        messages: [
          { role: 'system', content: systemInstruction },
          ...history.slice(-10).map((m) => ({ role: m.role, content: m.content })),
          { role: 'user', content: userMessage },
        ],
      }),
      signal: AbortSignal.timeout(25000),
    });
    if (res.status === 503 || res.status === 429) {
      throw new RetryableAiError(`Dịch vụ AI đang quá tải (${res.status}).`, res.status);
    }
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`Lỗi AI (${res.status}): ${errBody.slice(0, 220)}`);
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return data.choices?.[0]?.message?.content?.trim() || 'Không có phản hồi.';
  });
}

export async function listProviderModels(params: {
  provider: AiProvider;
  apiKey?: string;
  baseUrl?: string;
}): Promise<string[]> {
  const { provider } = params;
  if (provider === 'server_default' || provider === 'gemini') {
    return [
      'gemini-4-hydrogen',
      'gemini-4-neon',
      'gemini-4-carbon',
      'gemini-4-argon',
      'gemini-3.1-flash-lite',
    ];
  }

  const key = (params.apiKey || '').trim();
  if (!key) {
    throw new Error('Cần có API Key để lấy danh sách model từ nhà cung cấp.');
  }

  if (provider === 'anthropic') {
    const base = params.baseUrl
      ? assertSafeExternalUrl(params.baseUrl)
      : 'https://api.anthropic.com/v1';
    const res = await fetch(`${base}/models`, {
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      throw new Error(`Không thể tải danh sách model Anthropic (HTTP ${res.status}).`);
    }
    const data = (await res.json()) as { data?: Array<{ id: string }> };
    return (data.data ?? []).map((m) => m.id).filter(Boolean);
  }

  const base =
    provider === 'openai'
      ? 'https://api.openai.com/v1'
      : assertSafeExternalUrl(params.baseUrl || '');

  const res = await fetch(`${base}/models`, {
    headers: {
      Authorization: `Bearer ${key}`,
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    throw new Error(`Không thể tải danh sách model (HTTP ${res.status}).`);
  }
  const data = (await res.json()) as { data?: Array<{ id: string }> };
  return (data.data ?? []).map((m) => m.id).filter(Boolean);
}

export async function testAiConnection(
  settings: DbAiSettingsRow,
): Promise<{ ok: true; model: string; reply: string; latencyMs: number }> {
  const started = Date.now();
  const provider = (settings.provider || 'server_default') as AiProvider;
  const model = resolveChatModel(provider, settings);
  const reply = await advisorChatWithAi(
    settings,
    '- Kiểm tra kết nối AI từ trang Quản trị (số dư mẫu: 1.000.000 ₫).',
    [],
    'Hãy trả lời đúng một câu ngắn bằng tiếng Việt xác nhận kết nối AI hoạt động bình thường.',
  );
  return {
    ok: true,
    model,
    reply,
    latencyMs: Math.max(1, Date.now() - started),
  };
}

