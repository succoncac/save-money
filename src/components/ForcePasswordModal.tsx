import { useState, type FormEvent } from 'react';
import { Eye, EyeOff, KeyRound, LogOut } from 'lucide-react';
import { api } from '../api/client';
import type { AuthUser } from '../types';

interface ForcePasswordModalProps {
  user: AuthUser;
  onChanged: (updatedUser: AuthUser) => void;
  onLogout: () => void;
}

export function ForcePasswordModal({ user, onChanged, onLogout }: ForcePasswordModalProps) {
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showOld, setShowOld] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirmMismatch =
    confirmPassword.length > 0 && newPassword !== confirmPassword;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword.length < 6) {
      setError('Mật khẩu mới phải có ít nhất 6 ký tự.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Mật khẩu mới nhập lại không khớp.');
      return;
    }
    setLoading(true);
    try {
      const { user: updated } = await api.changePassword(oldPassword, newPassword, confirmPassword);
      onChanged(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể đổi mật khẩu.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <div className="w-11 h-11 rounded-2xl bg-emerald-50 text-emerald-700 flex items-center justify-center">
            <KeyRound className="w-5 h-5" />
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="px-3 py-2 rounded-xl text-xs font-medium text-slate-600 hover:bg-slate-100 flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Đăng xuất</span>
          </button>
        </div>

        <h1 className="mt-5 font-display text-2xl font-bold text-slate-900">
          Đổi mật khẩu lần đầu
        </h1>
        <p className="mt-2 text-sm text-slate-600 leading-relaxed">
          Xin chào <span className="font-semibold text-slate-900">{user.displayName}</span>. Để bảo vệ ví tiết kiệm, bạn cần đổi mật khẩu mới trước khi sử dụng.
        </p>

        {error && (
          <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label htmlFor="force-old-pw" className="block text-sm font-medium text-slate-700 mb-1.5">
              Mật khẩu cũ
            </label>
            <div className="relative">
              <input
                id="force-old-pw"
                type={showOld ? 'text' : 'password'}
                required
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                placeholder="Nhập mật khẩu hiện tại"
                className="w-full h-11 pl-4 pr-11 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
              <button
                type="button"
                onClick={() => setShowOld((v) => !v)}
                aria-label={showOld ? 'Ẩn mật khẩu cũ' : 'Hiện mật khẩu cũ'}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg text-slate-500 hover:bg-slate-100 flex items-center justify-center cursor-pointer"
              >
                {showOld ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div>
            <label htmlFor="force-new-pw" className="block text-sm font-medium text-slate-700 mb-1.5">
              Mật khẩu mới
            </label>
            <div className="relative">
              <input
                id="force-new-pw"
                type={showNew ? 'text' : 'password'}
                required
                minLength={6}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Tối thiểu 6 ký tự"
                className="w-full h-11 pl-4 pr-11 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
              <button
                type="button"
                onClick={() => setShowNew((v) => !v)}
                aria-label={showNew ? 'Ẩn mật khẩu mới' : 'Hiện mật khẩu mới'}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg text-slate-500 hover:bg-slate-100 flex items-center justify-center cursor-pointer"
              >
                {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div>
            <label htmlFor="force-confirm-pw" className="block text-sm font-medium text-slate-700 mb-1.5">
              Nhập lại mật khẩu mới
            </label>
            <div className="relative">
              <input
                id="force-confirm-pw"
                type={showConfirm ? 'text' : 'password'}
                required
                minLength={6}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Nhập lại mật khẩu mới"
                className="w-full h-11 pl-4 pr-11 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
              <button
                type="button"
                onClick={() => setShowConfirm((v) => !v)}
                aria-label={showConfirm ? 'Ẩn mật khẩu nhập lại' : 'Hiện mật khẩu nhập lại'}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg text-slate-500 hover:bg-slate-100 flex items-center justify-center cursor-pointer"
              >
                {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {confirmMismatch && (
              <p className="mt-1 text-xs text-red-600">Mật khẩu nhập lại chưa khớp.</p>
            )}
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full h-12 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-semibold text-sm transition-colors cursor-pointer"
          >
            {loading ? 'Đang cập nhật...' : 'Cập nhật mật khẩu & Tiếp tục'}
          </button>
        </form>
      </div>
    </div>
  );
}
