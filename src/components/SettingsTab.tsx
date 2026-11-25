import { useEffect, useState, type FormEvent } from 'react';
import {
  KeyRound,
  ShieldCheck,
  ShieldAlert,
  CheckCircle2,
  Copy,
  Check,
  QrCode,
  Clock,
  Camera,
  Bot,
  Eye,
  EyeOff,
} from 'lucide-react';
import { api } from '../api/client';
import type { AuthUser, SecurityAlert } from '../types';
import { MoneyText } from './MoneyText';

interface SettingsTabProps {
  user: AuthUser;
  alerts?: SecurityAlert[];
  onUserUpdated: (user: AuthUser) => void;
}

function formatSecretDisplay(secret: string): string {
  return secret.replace(/(.{4})/g, '$1 ').trim();
}

export function SettingsTab({ user, alerts = [], onUserUpdated }: SettingsTabProps) {
  // Change password state
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showOldPw, setShowOldPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [pwLoading, setPwLoading] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // 2FA setup & disable state
  const [tfaMsg, setTfaMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [setupPassword, setSetupPassword] = useState('');
  const [showSetupPw, setShowSetupPw] = useState(false);
  const [setupBusy, setSetupBusy] = useState(false);
  const [pendingQr, setPendingQr] = useState<string | null>(null);
  const [pendingSecret, setPendingSecret] = useState<string | null>(null);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [totpSecondsLeft, setTotpSecondsLeft] = useState(() => 30 - (Math.floor(Date.now() / 1000) % 30));

  const [confirmPasswordInput, setConfirmPasswordInput] = useState('');
  const [showConfirm2faPw, setShowConfirm2faPw] = useState(false);
  const [confirmCode, setConfirmCode] = useState('');
  const [confirmBusy, setConfirmBusy] = useState(false);

  const [showDisableForm, setShowDisableForm] = useState(false);
  const [disablePassword, setDisablePassword] = useState('');
  const [showDisablePw, setShowDisablePw] = useState(false);
  const [disableCode, setDisableCode] = useState('');
  const [disableBusy, setDisableBusy] = useState(false);

  useEffect(() => {
    if (!pendingQr) return;
    const timer = window.setInterval(() => {
      setTotpSecondsLeft(30 - (Math.floor(Date.now() / 1000) % 30));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [pendingQr]);

  async function handleChangePassword(e: FormEvent) {
    e.preventDefault();
    setPwMsg(null);
    if (newPassword.length < 6) {
      setPwMsg({ type: 'err', text: 'Mật khẩu mới phải có ít nhất 6 ký tự.' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwMsg({ type: 'err', text: 'Mật khẩu mới nhập lại không khớp.' });
      return;
    }
    setPwLoading(true);
    try {
      const { user: updated } = await api.changePassword(oldPassword, newPassword, confirmPassword);
      onUserUpdated(updated);
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPwMsg({ type: 'ok', text: 'Đã đổi mật khẩu thành công.' });
    } catch (err) {
      setPwMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Không thể đổi mật khẩu.',
      });
    } finally {
      setPwLoading(false);
    }
  }

  async function handleStartSetup2fa(e: FormEvent) {
    e.preventDefault();
    setTfaMsg(null);
    setSetupBusy(true);
    try {
      const { secret, qrDataUrl } = await api.setupTwoFactor(setupPassword);
      setPendingSecret(secret);
      setPendingQr(qrDataUrl);
      setSetupPassword('');
      setConfirmPasswordInput('');
      setConfirmCode('');
    } catch (err) {
      setTfaMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Không thể khởi tạo mã xác minh 2 bước.',
      });
    } finally {
      setSetupBusy(false);
    }
  }

  async function handleConfirm2fa(e: FormEvent) {
    e.preventDefault();
    setTfaMsg(null);
    setConfirmBusy(true);
    try {
      const { user: updated } = await api.confirmTwoFactor(confirmPasswordInput, confirmCode.trim());
      onUserUpdated(updated);
      setPendingQr(null);
      setPendingSecret(null);
      setConfirmPasswordInput('');
      setConfirmCode('');
      setTfaMsg({ type: 'ok', text: 'Đã kích hoạt xác minh 2 bước (2FA) thành công.' });
    } catch (err) {
      setTfaMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Không thể xác nhận bật 2FA.',
      });
    } finally {
      setConfirmBusy(false);
    }
  }

  async function handleDisable2fa(e: FormEvent) {
    e.preventDefault();
    setTfaMsg(null);
    setDisableBusy(true);
    try {
      const { user: updated } = await api.disableTwoFactor(disablePassword, disableCode.trim());
      onUserUpdated(updated);
      setShowDisableForm(false);
      setDisablePassword('');
      setDisableCode('');
      setTfaMsg({ type: 'ok', text: 'Đã tắt xác minh 2 bước (2FA) cho tài khoản.' });
    } catch (err) {
      setTfaMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Không thể tắt 2FA.',
      });
    } finally {
      setDisableBusy(false);
    }
  }

  async function handleCopySecret() {
    if (!pendingSecret) return;
    try {
      await navigator.clipboard.writeText(pendingSecret);
      setCopiedSecret(true);
      window.setTimeout(() => setCopiedSecret(false), 2000);
    } catch {
      // Clipboard may be blocked in restricted contexts
    }
  }

  return (
    <div className="space-y-6">
      {/* Account Status & Permissions Overview */}
      <section className="bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-bold text-slate-900">
            {user.displayName}{' '}
            <span className="font-mono text-xs font-normal text-slate-500">@{user.username}</span>
          </div>
          <div className="text-xs text-slate-500 mt-0.5">
            {user.isRootAdmin ? 'Quản trị gốc hệ thống' : user.role === 'admin' ? 'Quản trị viên phụ' : 'Tài khoản cá nhân'}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span
            className={`px-3 py-1.5 rounded-xl border font-medium inline-flex items-center gap-1.5 ${
              user.canUseCamera || user.role === 'admin'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : 'border-slate-200 bg-slate-50 text-slate-500'
            }`}
          >
            <Camera className="w-3.5 h-3.5" />
            <span>Camera AI: {user.canUseCamera || user.role === 'admin' ? 'Bật' : 'Tắt'}</span>
          </span>

          <span
            className={`px-3 py-1.5 rounded-xl border font-medium inline-flex items-center gap-1.5 ${
              user.canUseChat || user.role === 'admin'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : 'border-slate-200 bg-slate-50 text-slate-500'
            }`}
          >
            <Bot className="w-3.5 h-3.5" />
            <span>Trợ lý AI: {user.canUseChat || user.role === 'admin' ? 'Bật' : 'Tắt'}</span>
          </span>

          <span
            className={`px-3 py-1.5 rounded-xl border font-medium inline-flex items-center gap-1.5 ${
              user.twoFactorEnabled
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : 'border-slate-200 bg-slate-50 text-slate-600'
            }`}
          >
            {user.twoFactorEnabled ? (
              <ShieldCheck className="w-3.5 h-3.5" />
            ) : (
              <ShieldAlert className="w-3.5 h-3.5" />
            )}
            <span>2FA: {user.twoFactorEnabled ? 'Đang bật' : 'Chưa bật'}</span>
          </span>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* Password Change (3 fields) */}
        <section className="bg-white border border-slate-200/90 rounded-2xl p-5 sm:p-6">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center">
              <KeyRound className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-display text-base font-bold text-slate-900">Đổi mật khẩu</h2>
              <p className="text-xs text-slate-500">Cập nhật mật khẩu đăng nhập an toàn</p>
            </div>
          </div>

          {pwMsg && (
            <div
              role="status"
              className={`mb-4 rounded-xl border px-3.5 py-2.5 text-sm flex items-center gap-2 ${
                pwMsg.type === 'ok'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                  : 'border-red-200 bg-red-50 text-red-800'
              }`}
            >
              {pwMsg.type === 'ok' && <CheckCircle2 className="w-4 h-4 shrink-0" />}
              <span>{pwMsg.text}</span>
            </div>
          )}

          <form onSubmit={handleChangePassword} className="space-y-4">
            <div>
              <label htmlFor="set-old-pw" className="block text-sm font-medium text-slate-700 mb-1">
                Mật khẩu cũ
              </label>
              <div className="relative">
                <input
                  id="set-old-pw"
                  type={showOldPw ? 'text' : 'password'}
                  required
                  value={oldPassword}
                  onChange={(e) => setOldPassword(e.target.value)}
                  className="w-full h-11 pl-3.5 pr-11 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
                <button
                  type="button"
                  onClick={() => setShowOldPw((v) => !v)}
                  aria-label={showOldPw ? 'Ẩn mật khẩu cũ' : 'Hiện mật khẩu cũ'}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg text-slate-500 hover:bg-slate-100 flex items-center justify-center cursor-pointer"
                >
                  {showOldPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="set-new-pw" className="block text-sm font-medium text-slate-700 mb-1">
                Mật khẩu mới
              </label>
              <div className="relative">
                <input
                  id="set-new-pw"
                  type={showNewPw ? 'text' : 'password'}
                  required
                  minLength={6}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full h-11 pl-3.5 pr-11 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPw((v) => !v)}
                  aria-label={showNewPw ? 'Ẩn mật khẩu mới' : 'Hiện mật khẩu mới'}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg text-slate-500 hover:bg-slate-100 flex items-center justify-center cursor-pointer"
                >
                  {showNewPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="set-confirm-pw" className="block text-sm font-medium text-slate-700 mb-1">
                Nhập lại mật khẩu mới
              </label>
              <div className="relative">
                <input
                  id="set-confirm-pw"
                  type={showConfirmPw ? 'text' : 'password'}
                  required
                  minLength={6}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full h-11 pl-3.5 pr-11 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPw((v) => !v)}
                  aria-label={showConfirmPw ? 'Ẩn mật khẩu nhập lại' : 'Hiện mật khẩu nhập lại'}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg text-slate-500 hover:bg-slate-100 flex items-center justify-center cursor-pointer"
                >
                  {showConfirmPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {confirmPassword.length > 0 && confirmPassword !== newPassword && (
                <p className="mt-1 text-xs text-red-600">Mật khẩu nhập lại chưa khớp.</p>
              )}
            </div>

            <button
              type="submit"
              disabled={pwLoading}
              className="w-full h-11 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white text-sm font-semibold cursor-pointer"
            >
              {pwLoading ? 'Đang lưu...' : 'Cập nhật mật khẩu'}
            </button>
          </form>
        </section>

        {/* Two-Factor Authentication (2FA TOTP) */}
        <section className="bg-white border border-slate-200/90 rounded-2xl p-5 sm:p-6 space-y-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div
                className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                  user.twoFactorEnabled
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-slate-100 text-slate-600'
                }`}
              >
                {user.twoFactorEnabled ? (
                  <ShieldCheck className="w-5 h-5" />
                ) : (
                  <ShieldAlert className="w-5 h-5" />
                )}
              </div>
              <div>
                <h2 className="font-display text-base font-bold text-slate-900">
                  Xác minh 2 bước (2FA)
                </h2>
                <p className="text-xs text-slate-500">
                  {user.twoFactorEnabled
                    ? 'Trạng thái: Đang bật bảo vệ bằng mã 6 số'
                    : 'Trạng thái: Chưa kích hoạt'}
                </p>
              </div>
            </div>
          </div>

          {tfaMsg && (
            <div
              role="status"
              className={`rounded-xl border px-3.5 py-2.5 text-sm flex items-center gap-2 ${
                tfaMsg.type === 'ok'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                  : 'border-red-200 bg-red-50 text-red-800'
              }`}
            >
              {tfaMsg.type === 'ok' && <CheckCircle2 className="w-4 h-4 shrink-0" />}
              <span>{tfaMsg.text}</span>
            </div>
          )}

          {!user.twoFactorEnabled ? (
            pendingQr && pendingSecret ? (
              <div className="space-y-4">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                      <QrCode className="w-4 h-4 text-emerald-600" />
                      <span>Bước 2: Quét mã QR bằng Google Authenticator / Authy</span>
                    </div>
                    <span className="inline-flex items-center gap-1 text-[11px] font-mono text-slate-500">
                      <Clock className="w-3 h-3 text-emerald-600" />
                      <span>Làm mới sau {totpSecondsLeft}s</span>
                    </span>
                  </div>

                  <div className="flex flex-col sm:flex-row items-center gap-4">
                    <div className="bg-white p-2.5 rounded-xl border border-slate-200 shrink-0">
                      <img
                        src={pendingQr}
                        alt="Mã QR xác minh 2 bước"
                        className="w-40 h-40 object-contain"
                      />
                    </div>
                    <div className="flex-1 min-w-0 w-full space-y-2">
                      <div className="text-xs font-medium text-slate-600">
                        Hoặc nhập thủ công mã khóa bí mật:
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 font-mono text-xs text-slate-900 break-all select-all">
                        {formatSecretDisplay(pendingSecret)}
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleCopySecret()}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-xs font-medium text-slate-700 cursor-pointer"
                      >
                        {copiedSecret ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-600" />
                            <span>Đã sao chép khóa</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>Sao chép mã khóa bí mật</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                <form onSubmit={handleConfirm2fa} className="space-y-3.5">
                  <div>
                    <label htmlFor="tfa-confirm-pw" className="block text-sm font-medium text-slate-700 mb-1">
                      Xác nhận lại mật khẩu tài khoản
                    </label>
                    <div className="relative">
                      <input
                        id="tfa-confirm-pw"
                        type={showConfirm2faPw ? 'text' : 'password'}
                        required
                        value={confirmPasswordInput}
                        onChange={(e) => setConfirmPasswordInput(e.target.value)}
                        placeholder="Nhập mật khẩu để xác nhận bật 2FA"
                        className="w-full h-11 pl-3.5 pr-11 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirm2faPw((v) => !v)}
                        aria-label={showConfirm2faPw ? 'Ẩn mật khẩu xác nhận bật 2FA' : 'Hiện mật khẩu xác nhận bật 2FA'}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg text-slate-500 hover:bg-slate-100 flex items-center justify-center cursor-pointer"
                      >
                        {showConfirm2faPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label htmlFor="tfa-confirm-code" className="block text-sm font-medium text-slate-700 mb-1">
                      Mã xác minh 6 chữ số từ ứng dụng
                    </label>
                    <input
                      id="tfa-confirm-code"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      required
                      maxLength={6}
                      value={confirmCode}
                      onChange={(e) => setConfirmCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="000000"
                      className="w-full h-11 px-3.5 rounded-xl border border-slate-300 font-mono text-base tracking-[0.25em] text-center focus:outline-none focus:ring-2 focus:ring-emerald-600"
                    />
                  </div>

                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      type="submit"
                      disabled={confirmBusy}
                      className="flex-1 h-11 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-sm font-semibold cursor-pointer whitespace-nowrap"
                    >
                      {confirmBusy ? 'Đang xác nhận...' : 'Xác nhận bật 2FA'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPendingQr(null);
                        setPendingSecret(null);
                        setTfaMsg(null);
                      }}
                      className="h-11 px-4 rounded-xl border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                    >
                      Hủy
                    </button>
                  </div>
                </form>
              </div>
            ) : (
              <form onSubmit={handleStartSetup2fa} className="space-y-4">
                <p className="text-xs text-slate-600 leading-relaxed">
                  Bảo vệ ví tiền bằng mã xác thực 6 chữ số từ ứng dụng xác thực. Để bắt đầu tạo mã QR và khóa bí mật, vui lòng xác minh mật khẩu hiện tại của bạn.
                </p>
                <div>
                  <label htmlFor="tfa-setup-pw" className="block text-sm font-medium text-slate-700 mb-1">
                    Mật khẩu hiện tại để bật 2FA
                  </label>
                  <div className="relative">
                    <input
                      id="tfa-setup-pw"
                      type={showSetupPw ? 'text' : 'password'}
                      required
                      value={setupPassword}
                      onChange={(e) => setSetupPassword(e.target.value)}
                      placeholder="Nhập mật khẩu tài khoản"
                      className="w-full h-11 pl-3.5 pr-11 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSetupPw((v) => !v)}
                      aria-label={showSetupPw ? 'Ẩn mật khẩu bật 2FA' : 'Hiện mật khẩu bật 2FA'}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg text-slate-500 hover:bg-slate-100 flex items-center justify-center cursor-pointer"
                    >
                      {showSetupPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={setupBusy}
                  className="w-full h-11 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-sm font-semibold cursor-pointer"
                >
                  {setupBusy ? 'Đang tạo mã QR...' : 'Bật xác minh 2 bước'}
                </button>
              </form>
            )
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3.5 text-xs text-emerald-900 leading-relaxed">
                Tài khoản của bạn đang được bảo vệ bằng xác minh 2 bước. Mỗi lần đăng nhập sẽ yêu cầu mã 6 chữ số từ ứng dụng xác thực.
              </div>

              {showDisableForm ? (
                <form onSubmit={handleDisable2fa} className="space-y-3.5 pt-2 border-t border-slate-100">
                  <div>
                    <label htmlFor="tfa-disable-pw" className="block text-sm font-medium text-slate-700 mb-1">
                      Mật khẩu hiện tại
                    </label>
                    <div className="relative">
                      <input
                        id="tfa-disable-pw"
                        type={showDisablePw ? 'text' : 'password'}
                        required
                        value={disablePassword}
                        onChange={(e) => setDisablePassword(e.target.value)}
                        placeholder="Nhập mật khẩu để tắt 2FA"
                        className="w-full h-11 pl-3.5 pr-11 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
                      />
                      <button
                        type="button"
                        onClick={() => setShowDisablePw((v) => !v)}
                        aria-label={showDisablePw ? 'Ẩn mật khẩu tắt 2FA' : 'Hiện mật khẩu tắt 2FA'}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg text-slate-500 hover:bg-slate-100 flex items-center justify-center cursor-pointer"
                      >
                        {showDisablePw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label htmlFor="tfa-disable-code" className="block text-sm font-medium text-slate-700 mb-1">
                      Mã xác minh 6 chữ số hiện tại
                    </label>
                    <input
                      id="tfa-disable-code"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      required
                      maxLength={6}
                      value={disableCode}
                      onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="000000"
                      className="w-full h-11 px-3.5 rounded-xl border border-slate-300 font-mono text-base tracking-[0.25em] text-center focus:outline-none focus:ring-2 focus:ring-red-600"
                    />
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="submit"
                      disabled={disableBusy}
                      className="flex-1 h-11 px-4 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-sm font-semibold cursor-pointer whitespace-nowrap"
                    >
                      {disableBusy ? 'Đang tắt...' : 'Xác nhận tắt 2FA'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowDisableForm(false);
                        setDisablePassword('');
                        setDisableCode('');
                        setTfaMsg(null);
                      }}
                      className="h-11 px-4 rounded-xl border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                    >
                      Hủy
                    </button>
                  </div>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setShowDisableForm(true);
                    setTfaMsg(null);
                  }}
                  className="w-full h-11 rounded-xl border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 text-sm font-semibold cursor-pointer"
                >
                  Tắt xác minh 2 bước
                </button>
              )}
            </div>
          )}
        </section>
      </div>

      {/* Security Audit Log (shows anti-theft alert history even after marking read) */}
      {alerts.length > 0 && (
        <section className="bg-white border border-slate-200/90 rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="font-display text-base font-bold text-slate-900">
              Nhật ký cảnh báo chống lấy tiền ({alerts.length})
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Lưu lại toàn bộ lượt tài khoản khác thử nhập trùng số seri tiền của bạn.
            </p>
          </div>
          <div className="divide-y divide-slate-100">
            {alerts.slice(0, 15).map((a) => (
              <div
                key={a.id}
                className="px-5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
              >
                <div className="text-slate-700">
                  <span className="font-semibold text-slate-900">@{a.intruderUsername}</span> thử nhập seri{' '}
                  <span className="font-mono font-semibold text-red-700">{a.serialDisplay}</span>
                  {a.amount > 0 && (
                    <>
                      {' '}
                      (<MoneyText amount={a.amount} />)
                    </>
                  )}
                </div>
                <div className="text-slate-500 flex items-center gap-2 shrink-0">
                  <span>{new Date(a.createdAt).toLocaleString('vi-VN')}</span>
                  <span
                    className={`px-2 py-0.5 rounded-md font-medium ${
                      a.isRead ? 'bg-slate-100 text-slate-600' : 'bg-red-100 text-red-800'
                    }`}
                  >
                    {a.isRead ? 'Đã xem' : 'Chưa đọc'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
