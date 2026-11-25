import {
  ExternalLink,
  Globe,
  MessageCircle,
  PlayCircle,
  Send,
  Share2,
  Video,
} from 'lucide-react';
import type { LoginNotice, LoginSocialLink, NoticeTone, SocialPlatform } from '../types';
import { isValidSafeHttpUrl, SOCIAL_PLATFORMS } from '../utils/notice';

interface LoginNoticeCardProps {
  notice: Pick<LoginNotice, 'enabled' | 'tone' | 'badge' | 'title' | 'text' | 'links'>;
}

const TONE_STYLES: Record<
  NoticeTone,
  { container: string; badge: string; link: string }
> = {
  emerald: {
    container: 'bg-slate-800/85 border-emerald-500/35',
    badge: 'text-emerald-400',
    link: 'text-emerald-200 border-emerald-500/35 bg-emerald-500/10 hover:bg-emerald-500/20',
  },
  slate: {
    container: 'bg-slate-800/85 border-slate-700',
    badge: 'text-slate-300',
    link: 'text-slate-200 border-slate-600/80 bg-slate-700/45 hover:bg-slate-700/75',
  },
  amber: {
    container: 'bg-amber-950/45 border-amber-500/40',
    badge: 'text-amber-300',
    link: 'text-amber-200 border-amber-500/35 bg-amber-500/10 hover:bg-amber-500/20',
  },
  rose: {
    container: 'bg-rose-950/45 border-rose-500/40',
    badge: 'text-rose-300',
    link: 'text-rose-200 border-rose-500/35 bg-rose-500/10 hover:bg-rose-500/20',
  },
};

function renderPlatformIcon(platform: SocialPlatform) {
  switch (platform) {
    case 'discord':
    case 'zalo':
      return <MessageCircle className="w-3.5 h-3.5 shrink-0" />;
    case 'telegram':
      return <Send className="w-3.5 h-3.5 shrink-0" />;
    case 'youtube':
      return <PlayCircle className="w-3.5 h-3.5 shrink-0" />;
    case 'tiktok':
      return <Video className="w-3.5 h-3.5 shrink-0" />;
    case 'facebook':
    case 'x':
      return <Share2 className="w-3.5 h-3.5 shrink-0" />;
    default:
      return <Globe className="w-3.5 h-3.5 shrink-0" />;
  }
}

function getPlatformName(platform: SocialPlatform): string {
  return SOCIAL_PLATFORMS.find((p) => p.value === platform)?.label ?? 'Liên kết';
}

export function LoginNoticeCard({ notice }: LoginNoticeCardProps) {
  const safeLinks: LoginSocialLink[] = (notice.links || []).filter(
    (l) => Boolean(l.url && l.url.trim() && isValidSafeHttpUrl(l.url)),
  );

  const hasContent = Boolean(notice.title || notice.text || safeLinks.length > 0);
  if (!notice.enabled || !hasContent) {
    return null;
  }

  const style = TONE_STYLES[notice.tone] || TONE_STYLES.emerald;

  return (
    <div className={`rounded-2xl border p-5 ${style.container}`}>
      {notice.badge && (
        <div className={`text-xs font-semibold tracking-wide ${style.badge}`}>
          {notice.badge}
        </div>
      )}

      {notice.title && (
        <h3 className="mt-1.5 font-display text-base font-bold text-white leading-snug">
          {notice.title}
        </h3>
      )}

      {notice.text && (
        <p className="mt-2 text-sm text-slate-200 leading-relaxed whitespace-pre-line">
          {notice.text}
        </p>
      )}

      {safeLinks.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {safeLinks.map((link) => (
            <a
              key={link.id}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-medium transition-colors ${style.link}`}
            >
              {renderPlatformIcon(link.platform)}
              <span className="opacity-75">{getPlatformName(link.platform)}:</span>
              <span className="underline underline-offset-2">{link.label}</span>
              <ExternalLink className="w-3 h-3 opacity-75 shrink-0" />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
