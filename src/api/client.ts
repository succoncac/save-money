import type {
  AdminAiSettings,
  AdminInspectedCredentials,
  AuthUser,
  BillScanResult,
  ChatMessage,
  LoginNotice,
  LoginSocialLink,
  NoticeTone,
  SavingsGoal,
  SecurityAlert,
  WalletTransaction,
} from '../types';

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

let lockedHandler: ((msg: string) => void) | null = null;

export function registerAccountLockedHandler(fn: ((msg: string) => void) | null): void {
  lockedHandler = fn;
}

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('X-Requested-With', 'XMLHttpRequest');
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(url, {
    ...options,
    headers,
    credentials: 'include',
  });

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  if (!res.ok) {
    const code = typeof data.code === 'string' ? data.code : undefined;
    const message =
      typeof data.error === 'string' && data.error
        ? data.error
        : `Lỗi kết nối (${res.status})`;

    if (res.status === 403 && code === 'ACCOUNT_LOCKED' && lockedHandler) {
      lockedHandler(message);
    }
    throw new ApiError(message, res.status, code);
  }

  return data as T;
}

export const api = {
  getLoginNotice: () => request<LoginNotice>('/api/public/login-notice'),

  getSession: () =>
    request<{
      authenticated: boolean;
      user?: AuthUser;
      locked?: boolean;
      message?: string;
    }>('/api/auth/session'),

  bootstrapAdmin: (password: string, confirmPassword: string) =>
    request<{ user: AuthUser }>('/api/auth/bootstrap-admin', {
      method: 'POST',
      body: JSON.stringify({ password, confirmPassword }),
    }),

  login: (username: string, password: string) =>
    request<{ user?: AuthUser; requiresTwoFactor?: boolean; twoFactorToken?: string }>(
      '/api/auth/login',
      {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      },
    ),

  verifyTwoFactor: (twoFactorToken: string, code: string) =>
    request<{ user: AuthUser }>('/api/auth/verify-2fa', {
      method: 'POST',
      body: JSON.stringify({ twoFactorToken, code }),
    }),

  setupTwoFactor: (currentPassword: string) =>
    request<{ secret: string; qrDataUrl: string }>('/api/auth/2fa/setup', {
      method: 'POST',
      body: JSON.stringify({ currentPassword }),
    }),

  confirmTwoFactor: (currentPassword: string, code: string) =>
    request<{ user: AuthUser }>('/api/auth/2fa/confirm', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, code }),
    }),

  disableTwoFactor: (currentPassword: string, code: string) =>
    request<{ user: AuthUser }>('/api/auth/2fa/disable', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, code }),
    }),

  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),

  me: () => request<{ user: AuthUser; unreadAlertsCount: number }>('/api/auth/me'),

  changePassword: (oldPassword: string, newPassword: string, confirmPassword: string) =>
    request<{ user: AuthUser }>('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ oldPassword, newPassword, confirmPassword }),
    }),

  getTransactions: (params?: { search?: string; type?: string; method?: string }) => {
    const qs = new URLSearchParams();
    if (params?.search) qs.set('search', params.search);
    if (params?.type && params.type !== 'all') qs.set('type', params.type);
    if (params?.method && params.method !== 'all') qs.set('method', params.method);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request<{ transactions: WalletTransaction[] }>(`/api/transactions${suffix}`);
  },

  createTransaction: (payload: {
    type: 'deposit' | 'withdraw';
    amount: number;
    denomination: number | null;
    serialNumber: string | null;
    method: 'manual' | 'ai_scan';
    note: string;
    aiConfidence?: number | null;
  }) =>
    request<{ transaction: WalletTransaction }>('/api/transactions', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateTransaction: (
    id: string,
    payload: {
      type: 'deposit' | 'withdraw';
      amount: number;
      denomination: number | null;
      serialNumber: string | null;
      note: string;
    },
  ) =>
    request<{ transaction: WalletTransaction }>(`/api/transactions/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  deleteTransaction: (id: string) =>
    request<{ ok: boolean }>(`/api/transactions/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  getGoal: () => request<{ goal: SavingsGoal }>('/api/goal'),

  updateGoal: (title: string, targetAmount: number) =>
    request<{ goal: SavingsGoal }>('/api/goal', {
      method: 'PUT',
      body: JSON.stringify({ title, targetAmount }),
    }),

  getSecurityAlerts: () => request<{ alerts: SecurityAlert[] }>('/api/security-alerts'),

  markAlertRead: (id: string) =>
    request<{ ok: boolean }>(`/api/security-alerts/${encodeURIComponent(id)}/read`, {
      method: 'PATCH',
    }),

  markAllAlertsRead: () =>
    request<{ ok: boolean }>('/api/security-alerts/read-all', { method: 'POST' }),

  scanBill: (imageDataUrl: string) =>
    request<BillScanResult>('/api/ai/scan-bill', {
      method: 'POST',
      body: JSON.stringify({ imageDataUrl }),
    }),

  getAdvisorMessages: () => request<{ messages: ChatMessage[] }>('/api/advisor/messages'),

  sendAdvisorMessage: (message: string) =>
    request<{ userMessage: ChatMessage; assistantMessage: ChatMessage }>('/api/advisor/chat', {
      method: 'POST',
      body: JSON.stringify({ message }),
    }),

  clearAdvisorMessages: () =>
    request<{ ok: boolean }>('/api/advisor/messages', { method: 'DELETE' }),

  // Admin
  getAdminUsers: () => request<{ users: AuthUser[] }>('/api/admin/users'),

  createAdminUser: (payload: {
    username: string;
    displayName: string;
    password: string;
    role: 'admin' | 'user';
    canUseCamera: boolean;
    canUseChat: boolean;
  }) =>
    request<{ user: AuthUser }>('/api/admin/users', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateAdminUser: (
    id: string,
    payload: { displayName: string; role: 'admin' | 'user'; isLocked: boolean },
  ) =>
    request<{ user: AuthUser }>(`/api/admin/users/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  updateUserPermissions: (id: string, payload: { canUseCamera: boolean; canUseChat: boolean }) =>
    request<{ user: AuthUser }>(`/api/admin/users/${encodeURIComponent(id)}/permissions`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  bulkUpdatePermissions: (payload: { canUseCamera?: boolean; canUseChat?: boolean }) =>
    request<{ users: AuthUser[] }>('/api/admin/users/bulk-permissions', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  resetUserPassword: (id: string, newPassword: string, oldPassword?: string) =>
    request<{ ok: boolean }>(`/api/admin/users/${encodeURIComponent(id)}/reset-password`, {
      method: 'POST',
      body: JSON.stringify(oldPassword !== undefined ? { newPassword, oldPassword } : { newPassword }),
    }),

  inspectUserCredentials: (id: string, adminPassword: string) =>
    request<AdminInspectedCredentials>(
      `/api/admin/users/${encodeURIComponent(id)}/credentials`,
      {
        method: 'POST',
        body: JSON.stringify({ adminPassword }),
      },
    ),

  adminDisableUserTwoFactor: (id: string) =>
    request<{ user: AuthUser }>(`/api/admin/users/${encodeURIComponent(id)}/disable-2fa`, {
      method: 'POST',
    }),

  deleteAdminUser: (id: string) =>
    request<{ ok: boolean }>(`/api/admin/users/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  getAiSettings: () => request<{ settings: AdminAiSettings }>('/api/admin/ai-settings'),

  updateAiSettings: (payload: {
    provider: string;
    apiKey?: string;
    clearApiKey?: boolean;
    baseUrl: string;
    chatModel: string;
    visionModel: string;
    loginNoticeEnabled: boolean;
    loginNoticeTone: NoticeTone;
    loginNoticeBadge: string;
    loginNoticeTitle: string;
    loginNoticeText: string;
    loginSocialLinks: LoginSocialLink[];
  }) =>
    request<{ settings: AdminAiSettings }>('/api/admin/ai-settings', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  fetchAiModels: (payload: { provider: string; apiKey?: string; baseUrl?: string }) =>
    request<{ models: string[] }>('/api/admin/ai-models', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  testAiConnection: (payload: {
    provider: string;
    apiKey?: string;
    clearApiKey?: boolean;
    baseUrl?: string;
    chatModel?: string;
  }) =>
    request<{ ok: boolean; model: string; reply: string; latencyMs: number }>(
      '/api/admin/ai-test',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    ),
};
