import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  UserPlus,
  Lock,
  Unlock,
  KeyRound,
  Trash2,
  Camera,
  Bot,
  RefreshCw,
  Shield,
  ShieldOff,
  CheckCircle2,
  Plus,
  ArrowUp,
  ArrowDown,
  Eye,
  EyeOff,
  Search,
  Activity,
  ShieldCheck,
  Copy,
  Check,
  X,
} from 'lucide-react';
import { api } from '../api/client';
import type {
  AdminAiSettings,
  AdminInspectedCredentials,
  AiProvider,
  AuthUser,
  LoginSocialLink,
  NoticeTone,
  SocialPlatform,
  UserRole,
} from '../types';
import { NOTICE_TONES, SOCIAL_PLATFORMS } from '../utils/notice';
import { LoginNoticeCard } from './LoginNoticeCard';

interface AdminTabProps {
  currentUser: AuthUser;
  onNoticeUpdated: () => void;
}

export function AdminTab({ currentUser, onNoticeUpdated }: AdminTabProps) {
  const [subTab, setSubTab] = useState<'users' | 'ai' | 'notice'>('users');
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [userMsg, setUserMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Create user form
  const [newUsername, setNewUsername] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('user');
  const [newCam, setNewCam] = useState(true);
  const [newChat, setNewChat] = useState(true);
  const [creatingUser, setCreatingUser] = useState(false);

  // Reset password inline modal
  const [resetTarget, setResetTarget] = useState<AuthUser | null>(null);
  const [resetOldPassword, setResetOldPassword] = useState('');
  const [resetPasswordInput, setResetPasswordInput] = useState('');
  const [resetConfirmPassword, setResetConfirmPassword] = useState('');
  const [resetting, setResetting] = useState(false);

  // Inspect user credentials (password escrow + 2FA live code)
  const [inspectTarget, setInspectTarget] = useState<AuthUser | null>(null);
  const [inspectAdminPassword, setInspectAdminPassword] = useState('');
  const [inspectLoading, setInspectLoading] = useState(false);
  const [inspectError, setInspectError] = useState<string | null>(null);
  const [inspectData, setInspectData] = useState<AdminInspectedCredentials | null>(null);
  const [showRevealedPassword, setShowRevealedPassword] = useState(false);
  const [showRevealed2faSecret, setShowRevealed2faSecret] = useState(false);
  const [copiedCredField, setCopiedCredField] = useState<'pw' | 'totp' | 'secret' | null>(null);
  const [inspectRemainingSec, setInspectRemainingSec] = useState(30);

  // Edit user inline
  const [editTarget, setEditTarget] = useState<AuthUser | null>(null);
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editRole, setEditRole] = useState<UserRole>('user');

  // AI settings + Login notice
  const [aiSettings, setAiSettings] = useState<AdminAiSettings | null>(null);
  const [provider, setProvider] = useState<AiProvider>('server_default');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [clearApiKey, setClearApiKey] = useState(false);
  const [baseUrl, setBaseUrl] = useState('');
  const [chatModel, setChatModel] = useState('gemini-4-hydrogen');
  const [visionModel, setVisionModel] = useState('auto');
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [testingAi, setTestingAi] = useState(false);
  const [userSearch, setUserSearch] = useState('');

  const [noticeEnabled, setNoticeEnabled] = useState(true);
  const [noticeTone, setNoticeTone] = useState<NoticeTone>('emerald');
  const [noticeBadge, setNoticeBadge] = useState('Thông báo');
  const [noticeTitle, setNoticeTitle] = useState('');
  const [noticeText, setNoticeText] = useState('');
  const [socialLinks, setSocialLinks] = useState<LoginSocialLink[]>([]);

  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsMsg, setSettingsMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const actionPanelRef = useRef<HTMLDivElement | null>(null);

  function focusActionPanel() {
    window.requestAnimationFrame(() => {
      actionPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }

  useEffect(() => {
    void loadAll();
  }, []);

  useEffect(() => {
    if (!inspectData?.twoFactor.enabled) return;
    setInspectRemainingSec(inspectData.twoFactor.remainingSeconds || 30);
    const id = window.setInterval(() => {
      setInspectRemainingSec((prev) => {
        if (prev <= 1) {
          if (inspectTarget && inspectAdminPassword) {
            void refreshInspectedCredentials(inspectTarget.id, inspectAdminPassword);
          }
          return 30;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [inspectData?.user.id, inspectData?.twoFactor.enabled, inspectData?.twoFactor.currentCode]);

  async function loadAll() {
    setLoadingUsers(true);
    try {
      const [uRes, sRes] = await Promise.all([api.getAdminUsers(), api.getAiSettings()]);
      setUsers(uRes.users);
      setAiSettings(sRes.settings);
      setProvider(sRes.settings.provider);
      setBaseUrl(sRes.settings.baseUrl);
      setChatModel(sRes.settings.chatModel);
      setVisionModel(sRes.settings.visionModel);
      setNoticeEnabled(sRes.settings.loginNoticeEnabled);
      setNoticeTone(sRes.settings.loginNoticeTone);
      setNoticeBadge(sRes.settings.loginNoticeBadge);
      setNoticeTitle(sRes.settings.loginNoticeTitle);
      setNoticeText(sRes.settings.loginNoticeText);
      setSocialLinks(sRes.settings.loginSocialLinks || []);
    } catch (err) {
      setUserMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Không tải được dữ liệu quản trị.',
      });
    } finally {
      setLoadingUsers(false);
    }
  }

  async function handleCreateUser(e: FormEvent) {
    e.preventDefault();
    setUserMsg(null);
    setCreatingUser(true);
    try {
      const { user } = await api.createAdminUser({
        username: newUsername.trim(),
        displayName: newDisplayName.trim() || newUsername.trim(),
        password: newPassword,
        role: newRole,
        canUseCamera: newCam,
        canUseChat: newChat,
      });
      setUsers((prev) => [...prev, user]);
      setNewUsername('');
      setNewDisplayName('');
      setNewPassword('');
      setNewRole('user');
      setUserMsg({ type: 'ok', text: `Đã tạo tài khoản @${user.username}.` });
    } catch (err) {
      setUserMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Không thể tạo tài khoản.',
      });
    } finally {
      setCreatingUser(false);
    }
  }

  async function handleTogglePermission(u: AuthUser, field: 'camera' | 'chat') {
    setUserMsg(null);
    try {
      const { user: updated } = await api.updateUserPermissions(u.id, {
        canUseCamera: field === 'camera' ? !u.canUseCamera : u.canUseCamera,
        canUseChat: field === 'chat' ? !u.canUseChat : u.canUseChat,
      });
      setUsers((prev) => prev.map((item) => (item.id === u.id ? updated : item)));
    } catch (err) {
      setUserMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Không thể cập nhật quyền.',
      });
    }
  }

  async function handleBulkPermissions(payload: { canUseCamera?: boolean; canUseChat?: boolean }) {
    setUserMsg(null);
    try {
      const { users: updatedList } = await api.bulkUpdatePermissions(payload);
      setUsers(updatedList);
      setUserMsg({ type: 'ok', text: 'Đã cập nhật quyền hàng loạt (trừ Quản trị gốc).' });
    } catch (err) {
      setUserMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Lỗi cập nhật hàng loạt.',
      });
    }
  }

  async function handleToggleLock(u: AuthUser) {
    setUserMsg(null);
    try {
      const { user: updated } = await api.updateAdminUser(u.id, {
        displayName: u.displayName,
        role: u.role,
        isLocked: !u.isLocked,
      });
      setUsers((prev) => prev.map((item) => (item.id === u.id ? updated : item)));
      setUserMsg({
        type: 'ok',
        text: updated.isLocked
          ? `Đã khóa tài khoản @${updated.username}.`
          : `Đã mở khóa tài khoản @${updated.username}.`,
      });
    } catch (err) {
      setUserMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Không thể thay đổi trạng thái khóa.',
      });
    }
  }

  async function handleSaveEditUser(e: FormEvent) {
    e.preventDefault();
    if (!editTarget) return;
    setUserMsg(null);
    try {
      const { user: updated } = await api.updateAdminUser(editTarget.id, {
        displayName: editDisplayName.trim() || editTarget.displayName,
        role: editTarget.isRootAdmin ? 'admin' : editRole,
        isLocked: editTarget.isLocked,
      });
      setUsers((prev) => prev.map((item) => (item.id === editTarget.id ? updated : item)));
      setEditTarget(null);
      setUserMsg({ type: 'ok', text: `Đã cập nhật tài khoản @${updated.username}.` });
    } catch (err) {
      setUserMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Không thể cập nhật tài khoản.',
      });
    }
  }

  async function handleResetPassword(e: FormEvent) {
    e.preventDefault();
    if (!resetTarget) return;
    setUserMsg(null);

    const isSelf = resetTarget.id === currentUser.id;
    if (isSelf) {
      if (!resetOldPassword) {
        setUserMsg({ type: 'err', text: 'Bạn phải nhập mật khẩu cũ để đổi mật khẩu của chính mình.' });
        return;
      }
      if (resetPasswordInput !== resetConfirmPassword) {
        setUserMsg({ type: 'err', text: 'Mật khẩu mới nhập lại không khớp.' });
        return;
      }
    }

    setResetting(true);
    try {
      await api.resetUserPassword(
        resetTarget.id,
        resetPasswordInput,
        isSelf ? resetOldPassword : undefined,
      );
      setResetTarget(null);
      setResetOldPassword('');
      setResetPasswordInput('');
      setResetConfirmPassword('');
      setUserMsg({
        type: 'ok',
        text: isSelf
          ? 'Đã đổi mật khẩu tài khoản của bạn thành công.'
          : `Đã đặt lại mật khẩu cho @${resetTarget.username}. Người dùng sẽ phải đổi mật khẩu khi đăng nhập lại.`,
      });
    } catch (err) {
      setUserMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Không thể đặt lại mật khẩu.',
      });
    } finally {
      setResetting(false);
    }
  }

  function closeInspectPanel() {
    setInspectTarget(null);
    setInspectAdminPassword('');
    setInspectError(null);
    setInspectData(null);
    setShowRevealedPassword(false);
    setShowRevealed2faSecret(false);
    setCopiedCredField(null);
  }

  async function refreshInspectedCredentials(userId: string, adminPw: string) {
    try {
      const res = await api.inspectUserCredentials(userId, adminPw);
      setInspectData(res);
      setInspectRemainingSec(res.twoFactor.remainingSeconds || 30);
      setInspectError(null);
    } catch (err) {
      setInspectError(
        err instanceof Error ? err.message : 'Không thể làm mới thông tin bảo mật.',
      );
    }
  }

  async function handleInspectSubmit(e: FormEvent) {
    e.preventDefault();
    if (!inspectTarget) return;
    setInspectError(null);
    setInspectLoading(true);
    try {
      const res = await api.inspectUserCredentials(inspectTarget.id, inspectAdminPassword);
      setInspectData(res);
      setInspectRemainingSec(res.twoFactor.remainingSeconds || 30);
    } catch (err) {
      setInspectError(
        err instanceof Error ? err.message : 'Xác minh quản trị thất bại.',
      );
    } finally {
      setInspectLoading(false);
    }
  }

  async function copyCredValue(field: 'pw' | 'totp' | 'secret', value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedCredField(field);
      setTimeout(() => {
        setCopiedCredField((prev) => (prev === field ? null : prev));
      }, 1800);
    } catch {
      // Clipboard blocked
    }
  }

  async function handleAdminDisable2fa(u: AuthUser) {
    setUserMsg(null);
    try {
      const { user: updated } = await api.adminDisableUserTwoFactor(u.id);
      setUsers((prev) => prev.map((item) => (item.id === u.id ? updated : item)));
      setUserMsg({ type: 'ok', text: `Đã tắt xác minh 2 bước cho @${u.username}.` });
    } catch (err) {
      setUserMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Không thể tắt 2FA của tài khoản.',
      });
    }
  }

  async function handleDeleteUser(u: AuthUser) {
    setUserMsg(null);
    try {
      await api.deleteAdminUser(u.id);
      setUsers((prev) => prev.filter((item) => item.id !== u.id));
      setUserMsg({ type: 'ok', text: `Đã xóa tài khoản @${u.username}.` });
    } catch (err) {
      setUserMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Không thể xóa tài khoản.',
      });
    }
  }

  async function handleFetchModels() {
    setSettingsMsg(null);
    setFetchingModels(true);
    try {
      const res = await api.fetchAiModels({
        provider,
        apiKey: apiKeyInput.trim() || undefined,
        baseUrl: baseUrl.trim() || undefined,
      });
      setAvailableModels(res.models);
      setSettingsMsg({ type: 'ok', text: `Đã tải ${res.models.length} model từ nhà cung cấp.` });
    } catch (err) {
      setSettingsMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Không thể tải danh sách model.',
      });
    } finally {
      setFetchingModels(false);
    }
  }

  async function handleTestAi() {
    setSettingsMsg(null);
    setTestingAi(true);
    try {
      const res = await api.testAiConnection({
        provider,
        apiKey: apiKeyInput.trim() || undefined,
        clearApiKey,
        baseUrl: baseUrl.trim() || undefined,
        chatModel: chatModel.trim() || undefined,
      });
      setSettingsMsg({
        type: 'ok',
        text: `Kết nối AI thành công (${res.model} · ${res.latencyMs}ms): "${res.reply}"`,
      });
    } catch (err) {
      setSettingsMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Kiểm tra kết nối AI thất bại.',
      });
    } finally {
      setTestingAi(false);
    }
  }

  function applyNoticePreset(preset: 'onboarding' | 'maintenance') {
    setNoticeEnabled(true);
    if (preset === 'onboarding') {
      setNoticeTone('emerald');
      setNoticeBadge('Cấp tài khoản');
      setNoticeTitle('Chào mừng bạn đến với Ví Tiết Kiệm Cá Nhân');
      setNoticeText(
        'Ứng dụng quản lý tích lũy nội bộ. Vui lòng nhắn tin trực tiếp cho Admin qua các kênh bên dưới để được cấp tài khoản hoặc mở lại quyền truy cập.',
      );
    } else {
      setNoticeTone('amber');
      setNoticeBadge('Thông báo hệ thống');
      setNoticeTitle('Lưu ý bảo trì & bảo mật tài khoản');
      setNoticeText(
        'Hệ thống sẽ kiểm tra định kỳ các kết nối AI. Khuyến nghị bật Xác minh 2 bước (2FA) trong mục Cài đặt & Bảo mật để bảo vệ dữ liệu ví của bạn.',
      );
    }
  }

  function handleAddSocialLink() {
    if (socialLinks.length >= 10) return;
    const usedPlatforms = new Set(socialLinks.map((l) => l.platform));
    const nextMeta =
      SOCIAL_PLATFORMS.find((p) => !usedPlatforms.has(p.value)) ?? SOCIAL_PLATFORMS[0];
    setSocialLinks((prev) => [
      ...prev,
      {
        id: `link-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        platform: nextMeta.value,
        label: nextMeta.defaultLinkLabel,
        url: '',
      },
    ]);
  }

  function handleUpdateSocialLink(
    id: string,
    patch: Partial<Pick<LoginSocialLink, 'platform' | 'label' | 'url'>>,
  ) {
    setSocialLinks((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const nextPlatform = patch.platform ?? item.platform;
        let nextLabel = patch.label ?? item.label;
        if (patch.platform && patch.platform !== item.platform) {
          const oldDefault = SOCIAL_PLATFORMS.find((p) => p.value === item.platform)?.defaultLinkLabel;
          const newDefault = SOCIAL_PLATFORMS.find((p) => p.value === nextPlatform)?.defaultLinkLabel;
          if (!item.label.trim() || item.label === oldDefault) {
            nextLabel = newDefault ?? item.label;
          }
        }
        return { ...item, ...patch, platform: nextPlatform, label: nextLabel };
      }),
    );
  }

  function handleMoveSocialLink(index: number, direction: -1 | 1) {
    const targetIdx = index + direction;
    if (targetIdx < 0 || targetIdx >= socialLinks.length) return;
    setSocialLinks((prev) => {
      const copy = [...prev];
      const [moved] = copy.splice(index, 1);
      copy.splice(targetIdx, 0, moved);
      return copy;
    });
  }

  function handleRemoveSocialLink(id: string) {
    setSocialLinks((prev) => prev.filter((item) => item.id !== id));
  }

  async function handleSaveSettings(e: FormEvent) {
    e.preventDefault();
    setSettingsMsg(null);
    setSavingSettings(true);
    try {
      const cleanedLinks = socialLinks
        .map((l) => ({
          ...l,
          label: l.label.trim(),
          url: l.url.trim(),
        }))
        .filter((l) => l.url.length > 0);

      const res = await api.updateAiSettings({
        provider,
        apiKey: apiKeyInput.trim() || undefined,
        clearApiKey,
        baseUrl: baseUrl.trim(),
        chatModel: chatModel.trim(),
        visionModel: visionModel.trim() || 'auto',
        loginNoticeEnabled: noticeEnabled,
        loginNoticeTone: noticeTone,
        loginNoticeBadge: noticeBadge.trim(),
        loginNoticeTitle: noticeTitle.trim(),
        loginNoticeText: noticeText.trim(),
        loginSocialLinks: cleanedLinks,
      });
      setAiSettings(res.settings);
      setSocialLinks(res.settings.loginSocialLinks || []);
      setApiKeyInput('');
      setClearApiKey(false);
      onNoticeUpdated();
      setSettingsMsg({ type: 'ok', text: 'Đã lưu cấu hình hệ thống thành công.' });
    } catch (err) {
      setSettingsMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Không thể lưu cấu hình.',
      });
    } finally {
      setSavingSettings(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Sub-navigation */}
      <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-200/70 rounded-2xl w-fit">
        <button
          type="button"
          onClick={() => setSubTab('users')}
          className={`px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap cursor-pointer transition-colors ${
            subTab === 'users' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Tài khoản & Quyền
        </button>
        <button
          type="button"
          onClick={() => setSubTab('ai')}
          className={`px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap cursor-pointer transition-colors ${
            subTab === 'ai' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Cấu hình AI
        </button>
        <button
          type="button"
          onClick={() => setSubTab('notice')}
          className={`px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap cursor-pointer transition-colors ${
            subTab === 'notice' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Thông báo đăng nhập
        </button>
      </div>

      {subTab === 'users' && (
        <div className="space-y-6">
          {userMsg && (
            <div
              role="status"
              className={`rounded-2xl border px-4 py-3 text-sm ${
                userMsg.type === 'ok'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                  : 'border-red-200 bg-red-50 text-red-800'
              }`}
            >
              {userMsg.text}
            </div>
          )}

          {/* Create User Card */}
          <form
            onSubmit={handleCreateUser}
            className="bg-white border border-slate-200/90 rounded-2xl p-5 sm:p-6 space-y-4"
          >
            <div className="flex items-center gap-2">
              <UserPlus className="w-4 h-4 text-emerald-600" />
              <h2 className="font-display text-base font-bold text-slate-900">Tạo tài khoản mới</h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label htmlFor="new-u-name" className="block text-xs font-medium text-slate-600 mb-1">
                  Username
                </label>
                <input
                  id="new-u-name"
                  type="text"
                  required
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  placeholder="vd: minh_anh"
                  className="w-full h-10 px-3 rounded-xl border border-slate-300 text-sm"
                />
              </div>
              <div>
                <label htmlFor="new-u-display" className="block text-xs font-medium text-slate-600 mb-1">
                  Tên hiển thị
                </label>
                <input
                  id="new-u-display"
                  type="text"
                  value={newDisplayName}
                  onChange={(e) => setNewDisplayName(e.target.value)}
                  placeholder="vd: Minh Anh"
                  className="w-full h-10 px-3 rounded-xl border border-slate-300 text-sm"
                />
              </div>
              <div>
                <label htmlFor="new-u-pw" className="block text-xs font-medium text-slate-600 mb-1">
                  Mật khẩu ban đầu
                </label>
                <input
                  id="new-u-pw"
                  type="password"
                  required
                  minLength={6}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Tối thiểu 6 ký tự"
                  className="w-full h-10 px-3 rounded-xl border border-slate-300 text-sm"
                />
              </div>
              <div>
                <label htmlFor="new-u-role" className="block text-xs font-medium text-slate-600 mb-1">
                  Vai trò
                </label>
                <select
                  id="new-u-role"
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as UserRole)}
                  className="w-full h-10 px-3 rounded-xl border border-slate-300 text-sm bg-white"
                >
                  <option value="user">Người dùng</option>
                  <option value="admin">Quản trị viên (phụ)</option>
                </select>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4 pt-1">
              <div className="flex flex-wrap items-center gap-4 text-xs text-slate-700">
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newCam}
                    onChange={(e) => setNewCam(e.target.checked)}
                    className="rounded border-slate-300 text-emerald-600"
                  />
                  <span>Cho phép Camera AI</span>
                </label>
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newChat}
                    onChange={(e) => setNewChat(e.target.checked)}
                    className="rounded border-slate-300 text-emerald-600"
                  />
                  <span>Cho phép Trợ lý AI</span>
                </label>
              </div>

              <button
                type="submit"
                disabled={creatingUser}
                className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs font-semibold cursor-pointer whitespace-nowrap"
              >
                {creatingUser ? 'Đang tạo...' : 'Tạo tài khoản'}
              </button>
            </div>
          </form>

          {/* Bulk Permissions */}
          <div className="bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs font-semibold text-slate-700">
              Cấp / thu hồi quyền hàng loạt (áp dụng ngoài Quản trị gốc)
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void handleBulkPermissions({ canUseCamera: true })}
                className="px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-emerald-50 text-xs font-medium text-slate-700 cursor-pointer"
              >
                Bật Camera tất cả
              </button>
              <button
                type="button"
                onClick={() => void handleBulkPermissions({ canUseCamera: false })}
                className="px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-rose-50 text-xs font-medium text-slate-700 cursor-pointer"
              >
                Tắt Camera tất cả
              </button>
              <button
                type="button"
                onClick={() => void handleBulkPermissions({ canUseChat: true })}
                className="px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-emerald-50 text-xs font-medium text-slate-700 cursor-pointer"
              >
                Bật Chat AI tất cả
              </button>
              <button
                type="button"
                onClick={() => void handleBulkPermissions({ canUseChat: false })}
                className="px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-rose-50 text-xs font-medium text-slate-700 cursor-pointer"
              >
                Tắt Chat AI tất cả
              </button>
            </div>
          </div>

          {/* Inline Edit or Reset Password or Credential Inspection */}
          <div ref={actionPanelRef} />
          {editTarget && (
            <form
              onSubmit={handleSaveEditUser}
              className="bg-white border border-emerald-300 rounded-2xl p-5 space-y-3"
            >
              <div className="text-sm font-bold text-slate-900">
                Chỉnh sửa tài khoản @{editTarget.username}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  type="text"
                  required
                  value={editDisplayName}
                  onChange={(e) => setEditDisplayName(e.target.value)}
                  placeholder="Tên hiển thị"
                  aria-label="Tên hiển thị"
                  className="h-10 px-3 rounded-xl border border-slate-300 text-sm"
                />
                <select
                  value={editRole}
                  disabled={editTarget.isRootAdmin || editTarget.id === currentUser.id}
                  onChange={(e) => setEditRole(e.target.value as UserRole)}
                  aria-label="Vai trò"
                  className="h-10 px-3 rounded-xl border border-slate-300 text-sm bg-white disabled:bg-slate-100"
                >
                  <option value="user">Người dùng</option>
                  <option value="admin">Quản trị viên</option>
                </select>
              </div>
              {editTarget.id === currentUser.id && (
                <div className="text-xs text-slate-500">
                  Không thể tự hạ quyền quản trị hoặc tự khóa tài khoản đang đăng nhập.
                </div>
              )}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditTarget(null)}
                  className="px-3.5 py-2 rounded-xl border border-slate-300 text-xs text-slate-700 cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="px-3.5 py-2 rounded-xl bg-emerald-600 text-white text-xs font-semibold cursor-pointer"
                >
                  Lưu thay đổi
                </button>
              </div>
            </form>
          )}

          {resetTarget && (
            <form
              onSubmit={handleResetPassword}
              className="bg-white border border-amber-300 rounded-2xl p-5 space-y-3"
            >
              <div className="text-xs font-bold text-slate-900">
                {resetTarget.id === currentUser.id
                  ? `Đổi mật khẩu tài khoản của bạn (@${resetTarget.username}) — Bắt buộc nhập mật khẩu cũ`
                  : `Đặt lại mật khẩu mới cho @${resetTarget.username} (không cần mật khẩu cũ — người dùng phải đổi lại khi đăng nhập)`}
              </div>

              <div
                className={`grid grid-cols-1 gap-3 ${
                  resetTarget.id === currentUser.id ? 'sm:grid-cols-3' : 'sm:grid-cols-1'
                }`}
              >
                {resetTarget.id === currentUser.id && (
                  <input
                    id="admin-reset-old-pw"
                    type="password"
                    required
                    value={resetOldPassword}
                    onChange={(e) => setResetOldPassword(e.target.value)}
                    placeholder="Mật khẩu cũ (bắt buộc)"
                    aria-label="Mật khẩu cũ"
                    className="w-full h-10 px-3 rounded-xl border border-slate-300 text-sm"
                  />
                )}
                <input
                  id="admin-reset-pw"
                  type="password"
                  required
                  minLength={6}
                  value={resetPasswordInput}
                  onChange={(e) => setResetPasswordInput(e.target.value)}
                  placeholder={
                    resetTarget.id === currentUser.id
                      ? 'Mật khẩu mới (tối thiểu 6 ký tự)'
                      : 'Mật khẩu tạm (tối thiểu 6 ký tự)'
                  }
                  aria-label="Mật khẩu mới"
                  className="w-full h-10 px-3 rounded-xl border border-slate-300 text-sm"
                />
                {resetTarget.id === currentUser.id && (
                  <input
                    id="admin-reset-confirm-pw"
                    type="password"
                    required
                    minLength={6}
                    value={resetConfirmPassword}
                    onChange={(e) => setResetConfirmPassword(e.target.value)}
                    placeholder="Nhập lại mật khẩu mới"
                    aria-label="Nhập lại mật khẩu mới"
                    className="w-full h-10 px-3 rounded-xl border border-slate-300 text-sm"
                  />
                )}
              </div>

              <div className="flex justify-end items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setResetTarget(null);
                    setResetOldPassword('');
                    setResetPasswordInput('');
                    setResetConfirmPassword('');
                  }}
                  className="px-3.5 py-2 rounded-xl border border-slate-300 text-xs text-slate-700 cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={resetting}
                  className="px-3.5 py-2 rounded-xl bg-slate-900 text-white text-xs font-semibold cursor-pointer"
                >
                  {resetting
                    ? 'Đang xử lý...'
                    : resetTarget.id === currentUser.id
                      ? 'Đổi mật khẩu của tôi'
                      : 'Xác nhận đặt lại'}
                </button>
              </div>
            </form>
          )}

          {inspectTarget && (
            <div className="bg-slate-900 text-slate-100 border border-slate-800 rounded-2xl p-5 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-emerald-500/15 text-emerald-400 flex items-center justify-center shrink-0">
                    <ShieldCheck className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-white">
                      Thông tin bảo mật &amp; 2FA: {inspectTarget.displayName} (@{inspectTarget.username})
                    </div>
                    <div className="text-xs text-slate-400">
                      Thông tin mật khẩu và khóa 2FA được mã hóa nhiều lớp; chỉ hiển thị tạm thời sau khi xác nhận mật khẩu quản trị.
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={closeInspectPanel}
                  aria-label="Đóng khung xem bảo mật"
                  className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center shrink-0 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {inspectError && (
                <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-3.5 py-2 text-xs text-red-200">
                  {inspectError}
                </div>
              )}

              {!inspectData ? (
                <form onSubmit={handleInspectSubmit} className="flex flex-col sm:flex-row items-stretch sm:items-end gap-3">
                  <div className="flex-1">
                    <label htmlFor="admin-inspect-pw" className="block text-xs font-medium text-slate-300 mb-1">
                      Nhập mật khẩu quản trị của bạn (@{currentUser.username}) để mở khóa xem
                    </label>
                    <input
                      id="admin-inspect-pw"
                      type="password"
                      required
                      value={inspectAdminPassword}
                      onChange={(e) => setInspectAdminPassword(e.target.value)}
                      placeholder="Mật khẩu quản trị của bạn"
                      className="w-full h-10 px-3 rounded-xl border border-slate-700 bg-slate-800 text-white text-sm placeholder:text-slate-500"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={closeInspectPanel}
                      className="px-3.5 h-10 rounded-xl border border-slate-700 text-xs text-slate-300 hover:bg-slate-800 cursor-pointer"
                    >
                      Hủy
                    </button>
                    <button
                      type="submit"
                      disabled={inspectLoading}
                      className="px-4 h-10 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white text-xs font-semibold cursor-pointer whitespace-nowrap"
                    >
                      {inspectLoading ? 'Đang giải mã...' : 'Xác nhận & Xem'}
                    </button>
                  </div>
                </form>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Password box */}
                  <div className="rounded-xl border border-slate-800 bg-slate-800/60 p-4 space-y-2.5">
                    <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                      Mật khẩu đăng nhập
                    </div>
                    {inspectData.passwordStatus === 'available' && inspectData.password ? (
                      <div className="space-y-2.5">
                        <div className="flex items-center justify-between gap-2 rounded-lg bg-slate-950/70 px-3 py-2 border border-slate-800">
                          <span className="font-mono text-sm text-white break-all">
                            {showRevealedPassword ? inspectData.password : '••••••••••••'}
                          </span>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => setShowRevealedPassword((v) => !v)}
                              className="px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 inline-flex items-center gap-1 cursor-pointer"
                            >
                              {showRevealedPassword ? (
                                <>
                                  <EyeOff className="w-3.5 h-3.5" />
                                  <span>Ẩn</span>
                                </>
                              ) : (
                                <>
                                  <Eye className="w-3.5 h-3.5" />
                                  <span>Hiện</span>
                                </>
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => void copyCredValue('pw', inspectData.password!)}
                              className="px-2 py-1 rounded-md bg-emerald-600/20 hover:bg-emerald-600/30 text-xs text-emerald-300 inline-flex items-center gap-1 cursor-pointer"
                            >
                              {copiedCredField === 'pw' ? (
                                <>
                                  <Check className="w-3.5 h-3.5" />
                                  <span>Đã chép</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3.5 h-3.5" />
                                  <span>Chép</span>
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                        <div className="text-[11px] text-slate-400">
                          Mật khẩu chỉ hiển thị tạm thời và tự ẩn khỏi giao diện khi bạn đóng bảng này.
                        </div>
                      </div>
                    ) : (
                      <div className="text-xs text-slate-300 leading-relaxed">
                        Tài khoản này chưa có bản lưu khôi phục mật khẩu. Hệ thống sẽ tự cập nhật sau khi người dùng đăng nhập lại hoặc quản trị viên đặt lại mật khẩu mới.
                      </div>
                    )}
                  </div>

                  {/* 2FA box */}
                  <div className="rounded-xl border border-slate-800 bg-slate-800/60 p-4 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                        Xác minh 2 bước (2FA)
                      </span>
                      {inspectData.twoFactor.enabled && (
                        <span className="font-mono text-[11px] font-semibold text-emerald-400">
                          Đổi sau {inspectRemainingSec}s
                        </span>
                      )}
                    </div>

                    {inspectData.twoFactor.enabled && inspectData.twoFactor.currentCode ? (
                      <div className="space-y-2.5">
                        <div className="flex items-center justify-between gap-2 rounded-lg bg-slate-950/70 px-3 py-2 border border-slate-800">
                          <span className="font-mono text-xl font-bold tracking-[0.2em] text-emerald-400 tabular-nums">
                            {inspectData.twoFactor.currentCode}
                          </span>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() =>
                                void refreshInspectedCredentials(inspectData.user.id, inspectAdminPassword)
                              }
                              aria-label="Làm mới mã 2FA"
                              className="px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 inline-flex items-center gap-1 cursor-pointer"
                            >
                              <RefreshCw className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                void copyCredValue('totp', inspectData.twoFactor.currentCode!)
                              }
                              className="px-2 py-1 rounded-md bg-emerald-600/20 hover:bg-emerald-600/30 text-xs text-emerald-300 inline-flex items-center gap-1 cursor-pointer"
                            >
                              {copiedCredField === 'totp' ? (
                                <>
                                  <Check className="w-3.5 h-3.5" />
                                  <span>Đã chép</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3.5 h-3.5" />
                                  <span>Chép mã</span>
                                </>
                              )}
                            </button>
                          </div>
                        </div>

                        {inspectData.twoFactor.secret && (
                          <div className="space-y-2">
                            <button
                              type="button"
                              onClick={() => setShowRevealed2faSecret((v) => !v)}
                              className="text-xs font-medium text-emerald-400 hover:underline cursor-pointer"
                            >
                              {showRevealed2faSecret ? 'Ẩn khóa bí mật & mã QR' : 'Xem khóa bí mật & mã QR 2FA'}
                            </button>

                            {showRevealed2faSecret && (
                              <div className="rounded-lg border border-slate-700 bg-slate-900 p-3 flex flex-col sm:flex-row items-center gap-3">
                                {inspectData.twoFactor.qrDataUrl && (
                                  <img
                                    src={inspectData.twoFactor.qrDataUrl}
                                    alt={`QR 2FA của ${inspectData.user.username}`}
                                    className="w-24 h-24 rounded-lg bg-white p-1 shrink-0"
                                  />
                                )}
                                <div className="min-w-0 flex-1 space-y-1.5">
                                  <div className="text-[11px] text-slate-400">Khóa bí mật:</div>
                                  <div className="font-mono text-xs text-white break-all">
                                    {inspectData.twoFactor.secret}
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void copyCredValue('secret', inspectData.twoFactor.secret!)
                                    }
                                    className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[11px] text-slate-200 inline-flex items-center gap-1 cursor-pointer"
                                  >
                                    {copiedCredField === 'secret' ? (
                                      <>
                                        <Check className="w-3 h-3 text-emerald-400" />
                                        <span>Đã chép khóa</span>
                                      </>
                                    ) : (
                                      <>
                                        <Copy className="w-3 h-3" />
                                        <span>Chép khóa bí mật</span>
                                      </>
                                    )}
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-xs text-slate-400">
                        Tài khoản này chưa kích hoạt xác minh 2 bước (2FA).
                      </div>
                    )}
                  </div>
                </div>
              )}

              {inspectData && (
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={closeInspectPanel}
                    className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white cursor-pointer"
                  >
                    Đóng &amp; ẩn thông tin nhạy cảm
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Users Table / List */}
          {(() => {
            const q = userSearch.trim().toLowerCase();
            const filteredUsers = q
              ? users.filter(
                  (u) =>
                    u.username.toLowerCase().includes(q) ||
                    u.displayName.toLowerCase().includes(q),
                )
              : users;
            const twoFaCount = users.filter((u) => u.twoFactorEnabled).length;
            const lockedCount = users.filter((u) => u.isLocked).length;

            return (
              <div className="bg-white border border-slate-200/90 rounded-2xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <div className="font-display text-base font-bold text-slate-900">
                      Danh sách tài khoản ({filteredUsers.length}/{users.length})
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      Tổng: {users.length} · 2FA bật: {twoFaCount} · Đã khóa: {lockedCount}
                    </div>
                  </div>
                  <div className="relative w-full sm:w-64">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="search"
                      value={userSearch}
                      onChange={(e) => setUserSearch(e.target.value)}
                      placeholder="Tìm tên hoặc @username..."
                      aria-label="Tìm kiếm tài khoản"
                      className="w-full h-9 pl-9 pr-3 rounded-xl border border-slate-300 text-xs"
                    />
                  </div>
                </div>

                {loadingUsers ? (
                  <div className="p-6 text-sm text-slate-500">Đang tải danh sách tài khoản...</div>
                ) : filteredUsers.length === 0 ? (
                  <div className="p-6 text-sm text-slate-500 text-center">
                    Không tìm thấy tài khoản khớp với &ldquo;{userSearch}&rdquo;.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {filteredUsers.map((u) => {
                  const isProtectedRoot = u.isRootAdmin;
                  const isSelf = u.id === currentUser.id;
                  const blockedForSecondary = isProtectedRoot && !currentUser.isRootAdmin;
                  const canInspectCreds =
                    !blockedForSecondary &&
                    !(!currentUser.isRootAdmin && u.role === 'admin' && !isSelf);
                  const canDelete = !isProtectedRoot && !isSelf;
                  const canLock = !isProtectedRoot && !isSelf;

                  return (
                    <div
                      key={u.id}
                      className="px-5 py-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <span className="font-semibold text-sm text-slate-900">{u.displayName}</span>
                          <span className="font-mono text-xs text-slate-500">@{u.username}</span>
                          {isSelf && (
                            <span className="text-xs font-semibold text-emerald-700">(Bạn)</span>
                          )}
                          {isProtectedRoot && (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                              <Shield className="w-3.5 h-3.5" />
                              Quản trị gốc
                            </span>
                          )}
                          {!isProtectedRoot && u.role === 'admin' && (
                            <span className="text-xs font-medium text-slate-600">· Admin phụ</span>
                          )}
                          {u.isLocked && (
                            <span className="text-xs font-semibold text-red-600">· Đã khóa</span>
                          )}
                          {u.twoFactorEnabled && (
                            <span className="text-xs font-semibold text-emerald-700">· 2FA Bật</span>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {/* Camera Permission Toggle */}
                        <button
                          type="button"
                          disabled={blockedForSecondary}
                          onClick={() => void handleTogglePermission(u, 'camera')}
                          className={`px-3 py-1.5 rounded-xl border text-xs font-medium flex items-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed ${
                            u.canUseCamera
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                              : 'border-slate-200 bg-slate-50 text-slate-500'
                          }`}
                        >
                          <Camera className="w-3.5 h-3.5" />
                          <span>Camera: {u.canUseCamera ? 'Bật' : 'Tắt'}</span>
                        </button>

                        {/* Chat Permission Toggle */}
                        <button
                          type="button"
                          disabled={blockedForSecondary}
                          onClick={() => void handleTogglePermission(u, 'chat')}
                          className={`px-3 py-1.5 rounded-xl border text-xs font-medium flex items-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed ${
                            u.canUseChat
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                              : 'border-slate-200 bg-slate-50 text-slate-500'
                          }`}
                        >
                          <Bot className="w-3.5 h-3.5" />
                          <span>Chat AI: {u.canUseChat ? 'Bật' : 'Tắt'}</span>
                        </button>

                        {/* Edit Display/Role */}
                        <button
                          type="button"
                          disabled={blockedForSecondary}
                          onClick={() => {
                            setEditTarget(u);
                            setEditDisplayName(u.displayName);
                            setEditRole(u.role);
                            focusActionPanel();
                          }}
                          className="px-3 py-1.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-medium text-slate-700 cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
                        >
                          Sửa
                        </button>

                        {/* Reset / Change Password */}
                        <button
                          type="button"
                          disabled={blockedForSecondary}
                          title={
                            isSelf
                              ? 'Đổi mật khẩu của bạn (bắt buộc nhập mật khẩu cũ)'
                              : `Đặt lại mật khẩu cho @${u.username}`
                          }
                          aria-label={
                            isSelf
                              ? `Đổi mật khẩu của bạn (${u.username})`
                              : `Đặt lại mật khẩu cho ${u.username}`
                          }
                          onClick={() => {
                            setResetTarget(u);
                            setResetOldPassword('');
                            setResetPasswordInput('');
                            setResetConfirmPassword('');
                            focusActionPanel();
                          }}
                          className="w-8 h-8 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 flex items-center justify-center cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
                        >
                          <KeyRound className="w-3.5 h-3.5" />
                        </button>

                        {/* Inspect 2FA & Password Escrow */}
                        <button
                          type="button"
                          disabled={!canInspectCreds}
                          title={
                            canInspectCreds
                              ? `Xem mã 2FA & mật khẩu của @${u.username}`
                              : 'Admin phụ không thể xem bảo mật của quản trị viên khác'
                          }
                          aria-label={`Xem 2FA và mật khẩu của ${u.username}`}
                          onClick={() => {
                            setInspectTarget(u);
                            setInspectAdminPassword('');
                            setInspectError(null);
                            setInspectData(null);
                            setShowRevealedPassword(false);
                            setShowRevealed2faSecret(false);
                            focusActionPanel();
                          }}
                          className="px-2.5 h-8 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-medium inline-flex items-center gap-1 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                          <span>2FA &amp; MK</span>
                        </button>

                        {/* Admin Disable 2FA if user lost authenticator */}
                        {u.twoFactorEnabled && (
                          <button
                            type="button"
                            disabled={blockedForSecondary}
                            title={`Tắt 2FA cho @${u.username}`}
                            aria-label={`Tắt 2FA cho ${u.username}`}
                            onClick={() => void handleAdminDisable2fa(u)}
                            className="px-2.5 h-8 rounded-xl border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-xs font-medium inline-flex items-center gap-1 cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
                          >
                            <ShieldOff className="w-3.5 h-3.5" />
                            <span>Tắt 2FA</span>
                          </button>
                        )}

                        {/* Lock / Unlock */}
                        <button
                          type="button"
                          disabled={!canLock}
                          aria-label={u.isLocked ? `Mở khóa ${u.username}` : `Khóa ${u.username}`}
                          onClick={() => void handleToggleLock(u)}
                          className={`w-8 h-8 rounded-xl border flex items-center justify-center cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed ${
                            u.isLocked
                              ? 'border-amber-300 bg-amber-50 text-amber-800'
                              : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                          }`}
                        >
                          {u.isLocked ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                        </button>

                        {/* Delete */}
                        <button
                          type="button"
                          disabled={!canDelete}
                          aria-label={`Xóa ${u.username}`}
                          onClick={() => void handleDeleteUser(u)}
                          className="w-8 h-8 rounded-xl border border-slate-200 hover:bg-red-50 hover:text-red-600 text-slate-500 flex items-center justify-center cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {subTab === 'ai' && (
        <form
          onSubmit={handleSaveSettings}
          className="bg-white border border-slate-200/90 rounded-2xl p-5 sm:p-6 space-y-5"
        >
          <div>
            <h2 className="font-display text-base font-bold text-slate-900">
              Cấu hình nhà cung cấp AI
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Khóa kết nối được lưu bảo mật và không hiển thị lại trên trình duyệt.
            </p>
          </div>

          {settingsMsg && (
            <div
              role="status"
              className={`rounded-xl border px-3.5 py-2.5 text-sm flex items-center gap-2 ${
                settingsMsg.type === 'ok'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                  : 'border-red-200 bg-red-50 text-red-800'
              }`}
            >
              {settingsMsg.type === 'ok' && <CheckCircle2 className="w-4 h-4 shrink-0" />}
              <span>{settingsMsg.text}</span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="ai-provider" className="block text-sm font-medium text-slate-700 mb-1">
                Nhà cung cấp AI
              </label>
              <select
                id="ai-provider"
                value={provider}
                onChange={(e) => setProvider(e.target.value as AiProvider)}
                className="w-full h-11 px-3.5 rounded-xl border border-slate-300 text-sm bg-white"
              >
                <option value="server_default">Mặc định hệ thống</option>
                <option value="openai_compatible">Chuẩn OpenAI (Base URL tùy chỉnh)</option>
                <option value="anthropic">Anthropic (Claude)</option>
                <option value="gemini">Google Gemini (Khóa riêng)</option>
                <option value="openai">OpenAI</option>
              </select>
            </div>

            <div>
              <label htmlFor="ai-base-url" className="block text-sm font-medium text-slate-700 mb-1">
                Base URL (tùy chỉnh)
              </label>
              <input
                id="ai-base-url"
                type="url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.example.com/v1"
                className="w-full h-11 px-3.5 rounded-xl border border-slate-300 font-mono text-sm"
              />
            </div>

            <div className="md:col-span-2">
              <div className="flex items-center justify-between mb-1">
                <label htmlFor="ai-api-key" className="block text-sm font-medium text-slate-700">
                  API Key (chỉ ghi)
                </label>
                {aiSettings?.hasApiKey && (
                  <span className="text-xs font-medium text-emerald-700">
                    Đã lưu khóa bảo mật
                  </span>
                )}
              </div>
              <input
                id="ai-api-key"
                type="password"
                value={apiKeyInput}
                onChange={(e) => {
                  setApiKeyInput(e.target.value);
                  if (e.target.value) setClearApiKey(false);
                }}
                placeholder={
                  aiSettings?.hasApiKey
                    ? 'Nhập khóa mới nếu muốn thay thế (để trống để giữ khóa cũ)'
                    : 'Nhập API Key...'
                }
                className="w-full h-11 px-3.5 rounded-xl border border-slate-300 font-mono text-sm"
              />
              {aiSettings?.hasApiKey && (
                <label className="mt-2 inline-flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={clearApiKey}
                    onChange={(e) => setClearApiKey(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  <span>Xóa API Key đang lưu</span>
                </label>
              )}
            </div>

            <div>
              <label htmlFor="ai-chat-model" className="block text-sm font-medium text-slate-700 mb-1">
                Model Trợ lý AI (Chat)
              </label>
              <input
                id="ai-chat-model"
                type="text"
                value={chatModel}
                onChange={(e) => setChatModel(e.target.value)}
                placeholder="claude-opus-5 hoặc gemini-4-hydrogen"
                className="w-full h-11 px-3.5 rounded-xl border border-slate-300 font-mono text-sm"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label htmlFor="ai-vision-model" className="block text-sm font-medium text-slate-700">
                  Model Quét tờ tiền (Ảnh)
                </label>
                <button
                  type="button"
                  onClick={() => setVisionModel('auto')}
                  className="text-xs font-semibold text-emerald-700 hover:underline cursor-pointer"
                >
                  Đặt về auto
                </button>
              </div>
              <input
                id="ai-vision-model"
                type="text"
                value={visionModel}
                onChange={(e) => setVisionModel(e.target.value)}
                placeholder="auto"
                className="w-full h-11 px-3.5 rounded-xl border border-slate-300 font-mono text-sm"
              />
            </div>
          </div>

          {/* Fetch models & test AI connection */}
          <div className="pt-2 space-y-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                disabled={fetchingModels}
                onClick={() => void handleFetchModels()}
                className="px-4 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-60 text-xs font-semibold text-slate-800 inline-flex items-center gap-2 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${fetchingModels ? 'animate-spin' : ''}`} />
                <span>{fetchingModels ? 'Đang lấy danh sách...' : 'Lấy danh sách model'}</span>
              </button>

              <button
                type="button"
                disabled={testingAi}
                onClick={() => void handleTestAi()}
                className="px-4 py-2 rounded-xl border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-60 text-xs font-semibold text-emerald-800 inline-flex items-center gap-2 cursor-pointer"
              >
                <Activity className={`w-3.5 h-3.5 ${testingAi ? 'animate-pulse' : ''}`} />
                <span>{testingAi ? 'Đang kiểm tra...' : 'Kiểm tra kết nối AI'}</span>
              </button>
            </div>

            {availableModels.length > 0 && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5">
                <div className="text-xs font-semibold text-slate-700 mb-2">
                  Chọn nhanh model (bấm để gán cho Chat hoặc Ảnh):
                </div>
                <div className="flex flex-wrap gap-2">
                  {availableModels.map((m) => (
                    <div key={m} className="inline-flex items-center rounded-lg border border-slate-200 bg-white overflow-hidden text-xs">
                      <span className="px-2.5 py-1 font-mono text-slate-800">{m}</span>
                      <button
                        type="button"
                        onClick={() => setChatModel(m)}
                        className="px-2 py-1 border-l border-slate-200 hover:bg-emerald-50 text-emerald-700 font-medium cursor-pointer"
                      >
                        Chat
                      </button>
                      <button
                        type="button"
                        onClick={() => setVisionModel(m)}
                        className="px-2 py-1 border-l border-slate-200 hover:bg-slate-100 text-slate-700 font-medium cursor-pointer"
                      >
                        Ảnh
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={savingSettings}
              className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-sm font-semibold cursor-pointer"
            >
              {savingSettings ? 'Đang lưu...' : 'Lưu cấu hình AI'}
            </button>
          </div>
        </form>
      )}

      {subTab === 'notice' && (
        <form
          onSubmit={handleSaveSettings}
          className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start"
        >
          {/* Editor */}
          <div className="xl:col-span-7 bg-white border border-slate-200/90 rounded-2xl p-5 sm:p-6 space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-base font-bold text-slate-900">
                  Tùy chỉnh thông báo & Liên kết mạng xã hội
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  Hiển thị trên màn hình đăng nhập để hướng dẫn người dùng liên hệ Admin qua Discord, Facebook, Telegram, Zalo hoặc các kênh khác.
                </p>
              </div>

              <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={noticeEnabled}
                  onChange={(e) => setNoticeEnabled(e.target.checked)}
                  className="rounded border-slate-300 text-emerald-600"
                />
                <span>Hiển thị banner</span>
              </label>
            </div>

            {settingsMsg && (
              <div
                role="status"
                className={`rounded-xl border px-3.5 py-2.5 text-sm flex items-center gap-2 ${
                  settingsMsg.type === 'ok'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                    : 'border-red-200 bg-red-50 text-red-800'
                }`}
              >
                {settingsMsg.type === 'ok' && <CheckCircle2 className="w-4 h-4 shrink-0" />}
                <span>{settingsMsg.text}</span>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-slate-500">Mẫu nhanh:</span>
              <button
                type="button"
                onClick={() => applyNoticePreset('onboarding')}
                className="px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-emerald-50 hover:border-emerald-300 text-xs font-medium text-slate-700 cursor-pointer"
              >
                Mẫu: Nhắn Admin cấp tài khoản
              </button>
              <button
                type="button"
                onClick={() => applyNoticePreset('maintenance')}
                className="px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-amber-50 hover:border-amber-300 text-xs font-medium text-slate-700 cursor-pointer"
              >
                Mẫu: Bảo trì hệ thống
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="notice-badge" className="block text-sm font-medium text-slate-700 mb-1">
                  Nhãn đầu dòng
                </label>
                <input
                  id="notice-badge"
                  type="text"
                  maxLength={40}
                  value={noticeBadge}
                  onChange={(e) => setNoticeBadge(e.target.value)}
                  placeholder="Thông báo / Cần cấp tài khoản?"
                  className="w-full h-11 px-3.5 rounded-xl border border-slate-300 text-sm"
                />
              </div>

              <div>
                <label htmlFor="notice-tone" className="block text-sm font-medium text-slate-700 mb-1">
                  Màu sắc khung thông báo
                </label>
                <select
                  id="notice-tone"
                  value={noticeTone}
                  onChange={(e) => setNoticeTone(e.target.value as NoticeTone)}
                  className="w-full h-11 px-3.5 rounded-xl border border-slate-300 text-sm bg-white"
                >
                  {NOTICE_TONES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-2">
                <label htmlFor="notice-title" className="block text-sm font-medium text-slate-700 mb-1">
                  Tiêu đề nổi bật (tùy chọn)
                </label>
                <input
                  id="notice-title"
                  type="text"
                  maxLength={120}
                  value={noticeTitle}
                  onChange={(e) => setNoticeTitle(e.target.value)}
                  placeholder="Ví dụ: Liên hệ Admin để được cấp tài khoản ví"
                  className="w-full h-11 px-3.5 rounded-xl border border-slate-300 text-sm"
                />
              </div>

              <div className="sm:col-span-2">
                <label htmlFor="notice-text" className="block text-sm font-medium text-slate-700 mb-1">
                  Nội dung thông báo (hỗ trợ xuống dòng)
                </label>
                <textarea
                  id="notice-text"
                  rows={4}
                  maxLength={1000}
                  value={noticeText}
                  onChange={(e) => setNoticeText(e.target.value)}
                  placeholder="Nhập lời nhắc, hướng dẫn nhắn tin cho Admin để cấp tài khoản..."
                  className="w-full p-3.5 rounded-xl border border-slate-300 text-sm leading-relaxed"
                />
              </div>
            </div>

            {/* Dynamic Social Links Builder */}
            <div className="pt-4 border-t border-slate-100 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Liên kết mạng xã hội & Kênh liên hệ ({socialLinks.length}/10)
                  </h3>
                  <p className="text-xs text-slate-500">
                    Hiển thị dạng chữ có gạch dưới để người dùng bấm chuyển hướng trực tiếp.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={socialLinks.length >= 10}
                  onClick={handleAddSocialLink}
                  className="px-3 py-2 rounded-xl border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-50 text-emerald-800 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Thêm liên kết</span>
                </button>
              </div>

              {socialLinks.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 p-4 text-xs text-slate-500 text-center">
                  Chưa có liên kết nào. Bấm &ldquo;Thêm liên kết&rdquo; để gắn Discord, Facebook, Telegram, Zalo, YouTube, TikTok hoặc Website.
                </div>
              ) : (
                <div className="space-y-3">
                  {socialLinks.map((link, index) => {
                    const meta =
                      SOCIAL_PLATFORMS.find((p) => p.value === link.platform) ?? SOCIAL_PLATFORMS[0];
                    return (
                      <div
                        key={link.id}
                        className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-2.5"
                      >
                        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
                          <div className="sm:col-span-4">
                            <label className="block text-[11px] font-medium text-slate-600 mb-1">
                              Nền tảng
                            </label>
                            <select
                              value={link.platform}
                              aria-label={`Nền tảng liên kết ${index + 1}`}
                              onChange={(e) =>
                                handleUpdateSocialLink(link.id, {
                                  platform: e.target.value as SocialPlatform,
                                })
                              }
                              className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-xs font-medium"
                            >
                              {SOCIAL_PLATFORMS.map((p) => (
                                <option key={p.value} value={p.value}>
                                  {p.label}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="sm:col-span-8">
                            <label className="block text-[11px] font-medium text-slate-600 mb-1">
                              Chữ hiển thị (gạch dưới khi bấm)
                            </label>
                            <input
                              type="text"
                              maxLength={80}
                              value={link.label}
                              aria-label={`Nhãn liên kết ${index + 1}`}
                              onChange={(e) =>
                                handleUpdateSocialLink(link.id, { label: e.target.value })
                              }
                              placeholder={meta.defaultLinkLabel}
                              className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-xs"
                            />
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <input
                            type="url"
                            maxLength={300}
                            value={link.url}
                            aria-label={`URL liên kết ${index + 1}`}
                            onChange={(e) =>
                              handleUpdateSocialLink(link.id, { url: e.target.value })
                            }
                            placeholder={meta.placeholder}
                            className="flex-1 h-10 px-3 rounded-lg border border-slate-300 bg-white font-mono text-xs"
                          />
                          <button
                            type="button"
                            disabled={index === 0}
                            onClick={() => handleMoveSocialLink(index, -1)}
                            aria-label="Di chuyển lên"
                            className="w-9 h-10 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-35 flex items-center justify-center text-slate-600 cursor-pointer"
                          >
                            <ArrowUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={index === socialLinks.length - 1}
                            onClick={() => handleMoveSocialLink(index, 1)}
                            aria-label="Di chuyển xuống"
                            className="w-9 h-10 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-35 flex items-center justify-center text-slate-600 cursor-pointer"
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRemoveSocialLink(link.id)}
                            aria-label={`Xóa liên kết ${index + 1}`}
                            className="w-9 h-10 rounded-lg border border-slate-200 bg-white hover:bg-red-50 hover:text-red-600 flex items-center justify-center text-slate-500 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                disabled={savingSettings}
                className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-sm font-semibold cursor-pointer"
              >
                {savingSettings ? 'Đang lưu...' : 'Lưu thông báo đăng nhập'}
              </button>
            </div>
          </div>

          {/* Live Preview */}
          <div className="xl:col-span-5 bg-slate-900 rounded-2xl p-5 sm:p-6 space-y-3 border border-slate-800">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-400">
              <Eye className="w-3.5 h-3.5 text-emerald-400" />
              <span>Xem trước trên màn hình đăng nhập</span>
            </div>

            {!noticeEnabled ? (
              <div className="rounded-xl border border-slate-800 bg-slate-800/40 p-5 text-xs text-slate-400">
                Banner thông báo đang được tắt và sẽ không hiển thị khi đăng nhập.
              </div>
            ) : (
              <LoginNoticeCard
                notice={{
                  enabled: noticeEnabled,
                  tone: noticeTone,
                  badge: noticeBadge.trim() || 'Thông báo',
                  title: noticeTitle.trim(),
                  text: noticeText.trim(),
                  links: socialLinks,
                }}
              />
            )}
          </div>
        </form>
      )}
    </div>
  );
}
