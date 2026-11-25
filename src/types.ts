export type UserRole = 'admin' | 'user';
export type TransactionType = 'deposit' | 'withdraw';
export type TransactionMethod = 'manual' | 'ai_scan';
export type AiProvider =
  | 'server_default'
  | 'openai_compatible'
  | 'gemini'
  | 'openai'
  | 'anthropic';

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  isRootAdmin: boolean;
  isLocked: boolean;
  mustChangePassword: boolean;
  canUseCamera: boolean;
  canUseChat: boolean;
  twoFactorEnabled: boolean;
  createdAt: string;
}

export interface WalletTransaction {
  id: string;
  userId: string;
  type: TransactionType;
  amount: number;
  denomination: number | null;
  serialNumber: string | null;
  serialNormalized: string | null;
  method: TransactionMethod;
  note: string;
  aiConfidence: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface SavingsGoal {
  userId: string;
  title: string;
  targetAmount: number;
  updatedAt: string;
}

export interface SecurityAlert {
  id: string;
  ownerUserId: string;
  intruderUserId: string;
  intruderUsername: string;
  serialNormalized: string;
  serialDisplay: string;
  amount: number;
  source: string;
  isRead: boolean;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  userId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export type NoticeTone = 'emerald' | 'slate' | 'amber' | 'rose';
export type SocialPlatform =
  | 'discord'
  | 'facebook'
  | 'telegram'
  | 'zalo'
  | 'youtube'
  | 'tiktok'
  | 'x'
  | 'website';

export interface LoginSocialLink {
  id: string;
  platform: SocialPlatform;
  label: string;
  url: string;
}

export interface LoginNotice {
  enabled: boolean;
  tone: NoticeTone;
  badge: string;
  title: string;
  text: string;
  links: LoginSocialLink[];
  discordUrl?: string;
  discordLabel?: string;
  needsInitialAdminSetup?: boolean;
}

export interface AdminAiSettings {
  provider: AiProvider;
  hasApiKey: boolean;
  baseUrl: string;
  chatModel: string;
  visionModel: string;
  loginNoticeEnabled: boolean;
  loginNoticeTone: NoticeTone;
  loginNoticeBadge: string;
  loginNoticeTitle: string;
  loginNoticeText: string;
  loginSocialLinks: LoginSocialLink[];
  updatedAt: string;
}

export interface BillScanResult {
  denomination: number | null;
  serialNumber: string | null;
  serialNormalized: string | null;
  confidence: number;
  note: string;
  serialConflict?: {
    isConflict: boolean;
    message: string;
  } | null;
}

export interface AdminInspectedCredentials {
  user: {
    id: string;
    username: string;
    displayName: string;
    role: UserRole;
    isRootAdmin: boolean;
    twoFactorEnabled: boolean;
  };
  password: string | null;
  passwordStatus: 'available' | 'scrypt_only';
  twoFactor: {
    enabled: boolean;
    currentCode: string | null;
    remainingSeconds: number;
    secret: string | null;
    qrDataUrl: string | null;
  };
}

