import type { LoginSocialLink, NoticeTone, SocialPlatform } from '../types';

export const NOTICE_TONES: Array<{ value: NoticeTone; label: string }> = [
  { value: 'emerald', label: 'Xanh ngọc (Mặc định)' },
  { value: 'slate', label: 'Tối giản (Xám)' },
  { value: 'amber', label: 'Nhấn mạnh (Vàng hổ phách)' },
  { value: 'rose', label: 'Khẩn cấp (Đỏ hồng)' },
];

export const SOCIAL_PLATFORMS: Array<{
  value: SocialPlatform;
  label: string;
  defaultLinkLabel: string;
  placeholder: string;
}> = [
  {
    value: 'discord',
    label: 'Discord',
    defaultLinkLabel: 'Tham gia Discord',
    placeholder: 'https://discord.gg/...',
  },
  {
    value: 'facebook',
    label: 'Facebook',
    defaultLinkLabel: 'Theo dõi Facebook',
    placeholder: 'https://facebook.com/...',
  },
  {
    value: 'telegram',
    label: 'Telegram',
    defaultLinkLabel: 'Kênh Telegram',
    placeholder: 'https://t.me/...',
  },
  {
    value: 'zalo',
    label: 'Zalo',
    defaultLinkLabel: 'Nhóm Zalo hỗ trợ',
    placeholder: 'https://zalo.me/...',
  },
  {
    value: 'youtube',
    label: 'YouTube',
    defaultLinkLabel: 'Kênh YouTube',
    placeholder: 'https://youtube.com/@...',
  },
  {
    value: 'tiktok',
    label: 'TikTok',
    defaultLinkLabel: 'Kênh TikTok',
    placeholder: 'https://tiktok.com/@...',
  },
  {
    value: 'x',
    label: 'X / Twitter',
    defaultLinkLabel: 'Theo dõi trên X',
    placeholder: 'https://x.com/...',
  },
  {
    value: 'website',
    label: 'Website / Khác',
    defaultLinkLabel: 'Truy cập liên kết',
    placeholder: 'https://...',
  },
];

const VALID_PLATFORMS = new Set<SocialPlatform>(SOCIAL_PLATFORMS.map((p) => p.value));
const VALID_TONES = new Set<NoticeTone>(NOTICE_TONES.map((t) => t.value));

export function normalizeNoticeTone(tone: unknown): NoticeTone {
  return typeof tone === 'string' && VALID_TONES.has(tone as NoticeTone)
    ? (tone as NoticeTone)
    : 'emerald';
}

export function normalizeSocialPlatform(platform: unknown): SocialPlatform {
  return typeof platform === 'string' && VALID_PLATFORMS.has(platform as SocialPlatform)
    ? (platform as SocialPlatform)
    : 'website';
}

export function isValidSafeHttpUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return true;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export function sanitizeNoticeLinks(raw: unknown): LoginSocialLink[] {
  if (!Array.isArray(raw)) return [];
  const result: LoginSocialLink[] = [];

  for (let i = 0; i < raw.length && result.length < 10; i++) {
    const item = raw[i];
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const url = typeof obj.url === 'string' ? obj.url.trim().slice(0, 300) : '';
    if (!url || !isValidSafeHttpUrl(url)) continue;

    const platform = normalizeSocialPlatform(obj.platform);
    const meta = SOCIAL_PLATFORMS.find((p) => p.value === platform);
    const label =
      typeof obj.label === 'string' && obj.label.trim()
        ? obj.label.trim().slice(0, 80)
        : meta?.defaultLinkLabel ?? 'Truy cập liên kết';
    const id =
      typeof obj.id === 'string' && obj.id.trim()
        ? obj.id.trim().slice(0, 64)
        : `link-${i + 1}`;

    result.push({ id, platform, label, url });
  }

  return result;
}

export function parseStoredNoticeLinks(
  rawJson: string | null | undefined,
  legacyDiscordUrl?: string | null,
  legacyDiscordLabel?: string | null,
): LoginSocialLink[] {
  let parsed: unknown = [];
  if (typeof rawJson === 'string' && rawJson.trim()) {
    try {
      parsed = JSON.parse(rawJson);
    } catch {
      parsed = [];
    }
  }
  const links = sanitizeNoticeLinks(parsed);
  if (links.length > 0) return links;

  const legUrl = typeof legacyDiscordUrl === 'string' ? legacyDiscordUrl.trim() : '';
  if (legUrl && isValidSafeHttpUrl(legUrl)) {
    return [
      {
        id: 'legacy-discord',
        platform: 'discord',
        label:
          typeof legacyDiscordLabel === 'string' && legacyDiscordLabel.trim()
            ? legacyDiscordLabel.trim().slice(0, 80)
            : 'Tham gia cộng đồng Discord',
        url: legUrl.slice(0, 300),
      },
    ];
  }

  return [];
}
