import { ShieldAlert, Check, CheckCheck } from 'lucide-react';
import type { SecurityAlert } from '../types';
import { MoneyText } from './MoneyText';

interface SecurityAlertsBannerProps {
  alerts: SecurityAlert[];
  onMarkRead: (id: string) => Promise<void>;
  onMarkAllRead: () => Promise<void>;
  busy?: boolean;
}

export function SecurityAlertsBanner({
  alerts,
  onMarkRead,
  onMarkAllRead,
  busy = false,
}: SecurityAlertsBannerProps) {
  const unread = alerts.filter((a) => !a.isRead);
  if (unread.length === 0) return null;

  return (
    <section
      aria-label="Cảnh báo an toàn chống lấy tiền"
      className="mb-6 rounded-2xl border border-red-300 bg-red-50 p-4 sm:p-5 text-red-950"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-red-600 text-white flex items-center justify-center shrink-0 mt-0.5">
            <ShieldAlert className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-display text-base font-bold text-red-950">
              Cảnh báo an toàn chống lấy tiền ({unread.length})
            </h2>
            <p className="text-xs text-red-800">
              Phát hiện tài khoản khác tìm cách nạp tờ tiền trùng số seri đã lưu trong ví của bạn.
            </p>
          </div>
        </div>

        <button
          type="button"
          disabled={busy}
          onClick={() => void onMarkAllRead()}
          className="px-3.5 py-2 rounded-xl bg-red-700 hover:bg-red-800 disabled:opacity-60 text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
        >
          <CheckCheck className="w-4 h-4" />
          <span>Đánh dấu tất cả đã đọc</span>
        </button>
      </div>

      <div className="mt-4 divide-y divide-red-200/80 border-t border-red-200/80">
        {unread.map((alert) => {
          const dt = new Date(alert.createdAt);
          const timeLabel = Number.isNaN(dt.getTime())
            ? alert.createdAt
            : dt.toLocaleString('vi-VN', {
                day: '2-digit',
                month: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              });
          const sourceLabel =
            alert.source === 'ai_scan' ? 'Quét camera AI' : 'Nhập thủ công';

          return (
            <div
              key={alert.id}
              className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            >
              <div className="text-sm leading-relaxed">
                <span className="font-semibold">Tài khoản @{alert.intruderUsername}</span> đã thử sử dụng tờ tiền số seri{' '}
                <span className="font-mono font-semibold text-red-900">{alert.serialDisplay}</span>
                {alert.amount > 0 && (
                  <>
                    {' '}
                    mệnh giá <MoneyText amount={alert.amount} className="font-semibold text-red-900" />
                  </>
                )}
                <div className="mt-0.5 text-xs text-red-700">
                  {sourceLabel} · {timeLabel}
                </div>
              </div>

              <button
                type="button"
                disabled={busy}
                onClick={() => void onMarkRead(alert.id)}
                className="self-start sm:self-center px-3 py-1.5 rounded-lg border border-red-300 bg-white hover:bg-red-100 text-red-900 text-xs font-medium flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Đã đọc</span>
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
