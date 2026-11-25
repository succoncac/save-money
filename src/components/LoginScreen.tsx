import { useState, type FormEvent } from 'react';
import {
  Wallet,
  ShieldCheck,
  Lock,
  Eye,
  EyeOff,
  ArrowRight,
  ArrowLeft,
  AlertTriangle,
} from 'lucide-react';
import { api, ApiError } from '../api/client';
import type { AuthUser, LoginNotice } from '../types';
import { LoginNoticeCard } from './LoginNoticeCard';

interface LoginScreenProps {
  notice: LoginNotice | null;
  lockedBannerMessage: string | null;
  onSuccess: (user: AuthUser) => void;
  onNoticeRefresh: () => void;
}

export function LoginScreen({
  notice,
  lockedBannerMessage,
  onSuccess,
  onNoticeRefresh,
}: LoginScreenProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Two-factor step state
  const [twoFactorToken, setTwoFactorToken] = useState<string | null>(null);
  const [twoFactorCode, setTwoFactorCode] = useState('');

  // First-run bootstrap state (only active when ADMIN_INITIAL_PASSWORD is unset and no admin exists)
  const [setupPassword, setSetupPassword] = useState('');
  const [setupConfirm, setSetupConfirm] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsSetup = Boolean(notice?.needsInitialAdminSetup);

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api.login(username.trim(), password);
      if (res.requiresTwoFactor && res.twoFactorToken) {
        setTwoFactorToken(res.twoFactorToken);
        setTwoFactorCode('');
        return;
      }
      if (res.user) {
        onSuccess(res.user);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Không thể kết nối lúc này. Vui lòng thử lại.');
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyTwoFactor(e: FormEvent) {
    e.preventDefault();
    if (!twoFactorToken) return;
    setError(null);
    setLoading(true);
    try {
      const { user } = await api.verifyTwoFactor(twoFactorToken, twoFactorCode.trim());
      onSuccess(user);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Không thể xác minh mã 2 bước. Vui lòng thử lại.');
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleBootstrapAdmin(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (setupPassword.length < 6) {
      setError('Mật khẩu quản trị gốc phải có ít nhất 6 ký tự.');
      return;
    }
    if (setupPassword !== setupConfirm) {
      setError('Mật khẩu nhập lại không khớp.');
      return;
    }
    setLoading(true);
    try {
      const { user } = await api.bootstrapAdmin(setupPassword, setupConfirm);
      onNoticeRefresh();
      onSuccess(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể khởi tạo quản trị gốc.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col lg:flex-row">
      {/* Left Editorial Brand & Notice Panel */}
      <div className="lg:w-1/2 bg-slate-900 text-white p-6 sm:p-10 lg:p-16 flex flex-col justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center shrink-0">
              <Wallet className="w-5 h-5 text-white" />
            </div>
            <span className="font-display text-lg font-bold tracking-tight whitespace-nowrap">
              Ví Tiết Kiệm Cá Nhân
            </span>
          </div>

          <div className="mt-10 lg:mt-16 max-w-lg">
            <h1 className="font-display text-3xl sm:text-4xl font-bold leading-tight text-white [text-wrap:balance]">
              Ghi nhận từng tờ tiền, giữ trọn mục tiêu tích lũy VNĐ.
            </h1>
            <p className="mt-4 text-slate-300 text-base leading-relaxed">
              Quản lý thu chi tiền mặt cá nhân, quét nhanh mệnh giá tờ tiền và theo dõi tiến độ tích lũy theo ngày, theo tháng.
            </p>
          </div>
        </div>

        {/* Custom Notice Banner from /api/public/login-notice */}
        <div className="mt-8 lg:mt-12 space-y-6">
          {notice && <LoginNoticeCard notice={notice} />}

          <div className="flex items-center gap-3 text-xs text-slate-400">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>Truy cập riêng tư · Dữ liệu ví cá nhân được bảo vệ an toàn</span>
          </div>
        </div>
      </div>

      {/* Right Auth Form Panel */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-10 lg:p-16">
        <div className="w-full max-w-md">
          {lockedBannerMessage && (
            <div
              role="alert"
              className="mb-6 rounded-2xl border border-red-200 bg-red-50 p-4 flex items-start gap-3 text-red-900"
            >
              <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <div className="text-sm leading-relaxed font-medium">{lockedBannerMessage}</div>
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="mb-6 rounded-2xl border border-red-200 bg-red-50 p-4 flex items-start gap-3 text-red-900"
            >
              <Lock className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <div className="text-sm leading-relaxed">{error}</div>
            </div>
          )}

          {needsSetup ? (
            <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 shadow-sm">
              <div className="text-xs font-semibold text-emerald-700">Thiết lập lần đầu</div>
              <h2 className="mt-1 font-display text-2xl font-bold text-slate-900">
                Khởi tạo Quản trị gốc
              </h2>
              <p className="mt-2 text-sm text-slate-600 leading-relaxed">
                Thiết lập mật khẩu cho tài khoản quản trị ban đầu để bắt đầu sử dụng hệ thống.
              </p>

              <form onSubmit={handleBootstrapAdmin} className="mt-6 space-y-4">
                <div>
                  <label htmlFor="setup-username" className="block text-sm font-medium text-slate-700 mb-1.5">
                    Username
                  </label>
                  <input
                    id="setup-username"
                    type="text"
                    value="admin"
                    disabled
                    className="w-full h-11 px-4 rounded-xl border border-slate-200 bg-slate-100 text-slate-600 font-mono text-sm"
                  />
                </div>

                <div>
                  <label htmlFor="setup-password" className="block text-sm font-medium text-slate-700 mb-1.5">
                    Mật khẩu quản trị gốc
                  </label>
                  <input
                    id="setup-password"
                    type="password"
                    required
                    minLength={6}
                    value={setupPassword}
                    onChange={(e) => setSetupPassword(e.target.value)}
                    placeholder="Tối thiểu 6 ký tự"
                    className="w-full h-11 px-4 rounded-xl border border-slate-300 bg-white text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600"
                  />
                </div>

                <div>
                  <label htmlFor="setup-confirm" className="block text-sm font-medium text-slate-700 mb-1.5">
                    Nhập lại mật khẩu
                  </label>
                  <input
                    id="setup-confirm"
                    type="password"
                    required
                    minLength={6}
                    value={setupConfirm}
                    onChange={(e) => setSetupConfirm(e.target.value)}
                    placeholder="Xác nhận mật khẩu"
                    className="w-full h-11 px-4 rounded-xl border border-slate-300 bg-white text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full h-12 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <span>{loading ? 'Đang khởi tạo...' : 'Tạo tài khoản Quản trị gốc'}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </form>
            </div>
          ) : twoFactorToken ? (
            <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 shadow-sm">
              <div className="text-xs font-semibold text-emerald-700">Xác minh 2 bước (2FA)</div>
              <h2 className="mt-1 font-display text-2xl font-bold text-slate-900">
                Nhập mã xác thực
              </h2>
              <p className="mt-1.5 text-sm text-slate-500">
                Tài khoản <span className="font-mono font-semibold text-slate-800">@{username.trim()}</span> đã bật bảo vệ 2 lớp. Hãy nhập mã 6 chữ số từ ứng dụng xác thực.
              </p>

              <form onSubmit={handleVerifyTwoFactor} className="mt-6 space-y-4">
                <div>
                  <label htmlFor="login-2fa-code" className="block text-sm font-medium text-slate-700 mb-1.5">
                    Mã xác minh 6 số
                  </label>
                  <input
                    id="login-2fa-code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    required
                    maxLength={6}
                    autoFocus
                    value={twoFactorCode}
                    onChange={(e) => setTwoFactorCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="000000"
                    className="w-full h-12 px-4 rounded-xl border border-slate-300 bg-white text-slate-900 font-mono text-lg tracking-[0.3em] text-center focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full h-12 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <span>{loading ? 'Đang xác minh...' : 'Xác nhận đăng nhập'}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setTwoFactorToken(null);
                    setTwoFactorCode('');
                    setError(null);
                  }}
                  className="w-full h-10 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Quay lại đăng nhập</span>
                </button>
              </form>
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 shadow-sm">
              <h2 className="font-display text-2xl font-bold text-slate-900">Đăng nhập ví</h2>
              <p className="mt-1.5 text-sm text-slate-500">
                Đăng nhập bằng tài khoản của bạn để tiếp tục.
              </p>

              <form onSubmit={handleLogin} className="mt-6 space-y-4">
                <div>
                  <label htmlFor="login-username" className="block text-sm font-medium text-slate-700 mb-1.5">
                    Username
                  </label>
                  <input
                    id="login-username"
                    type="text"
                    required
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Nhập username của bạn"
                    className="w-full h-11 px-4 rounded-xl border border-slate-300 bg-white text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600"
                  />
                </div>

                <div>
                  <label htmlFor="login-password" className="block text-sm font-medium text-slate-700 mb-1.5">
                    Mật khẩu
                  </label>
                  <div className="relative">
                    <input
                      id="login-password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Nhập mật khẩu"
                      className="w-full h-11 pl-4 pr-11 rounded-xl border border-slate-300 bg-white text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? 'Ẩn ký tự' : 'Hiển thị ký tự'}
                      className="absolute right-1 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center text-slate-500 hover:text-slate-800 rounded-lg cursor-pointer"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full h-12 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <span>{loading ? 'Đang đăng nhập...' : 'Đăng nhập'}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
