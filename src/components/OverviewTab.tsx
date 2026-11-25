import { useRef, useState, type FormEvent } from 'react';
import {
  Camera,
  TrendingUp,
  Calendar,
  Target,
  Pencil,
  ArrowUpRight,
  ArrowDownLeft,
  ChevronRight,
} from 'lucide-react';
import type { SavingsGoal, WalletTransaction } from '../types';
import { computeCashflowSummary } from '../utils/cashflow';
import { parseVndInput } from '../utils/currency';
import { MoneyText } from './MoneyText';
import { GrowthChartSvg } from './GrowthChartSvg';

interface OverviewTabProps {
  transactions: WalletTransaction[];
  goal: SavingsGoal;
  loading: boolean;
  onUpdateGoal: (title: string, targetAmount: number) => Promise<void>;
  onNavigate: (tab: 'scan' | 'history') => void;
}

export function OverviewTab({
  transactions,
  goal,
  loading,
  onUpdateGoal,
  onNavigate,
}: OverviewTabProps) {
  const [editingGoal, setEditingGoal] = useState(false);
  const [goalTitle, setGoalTitle] = useState(goal.title);
  const [goalTargetInput, setGoalTargetInput] = useState(String(goal.targetAmount));
  const [savingGoal, setSavingGoal] = useState(false);
  const [goalError, setGoalError] = useState<string | null>(null);
  const goalFormRef = useRef<HTMLFormElement | null>(null);

  const summary = computeCashflowSummary(transactions);
  const progressPct =
    goal.targetAmount > 0
      ? Math.max(0, Math.min(100, Math.round((summary.netBalance / goal.targetAmount) * 100)))
      : 0;
  const remainingToGoal = Math.max(0, goal.targetAmount - summary.netBalance);
  const net14d = summary.dailySeries.reduce((acc, p) => acc + p.netChange, 0);
  const avgDaily14d = summary.dailySeries.length > 0 ? net14d / summary.dailySeries.length : 0;
  const estDaysToGoal =
    remainingToGoal > 0 && avgDaily14d > 0
      ? Math.max(1, Math.ceil(remainingToGoal / avgDaily14d))
      : null;

  const recentTx = transactions.slice(0, 5);
  const maxDenomAmount = Math.max(
    1,
    ...summary.denominationBreakdown.map((d) => Math.abs(d.totalAmount)),
  );

  function openEditGoal() {
    setGoalTitle(goal.title);
    setGoalTargetInput(String(goal.targetAmount));
    setGoalError(null);
    setEditingGoal(true);
    window.setTimeout(() => {
      goalFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 30);
  }

  async function handleSaveGoal(e: FormEvent) {
    e.preventDefault();
    setGoalError(null);
    const parsed = parseVndInput(goalTargetInput);
    if (!parsed) {
      setGoalError('Số tiền mục tiêu phải là số nguyên dương.');
      return;
    }
    setSavingGoal(true);
    try {
      await onUpdateGoal(goalTitle.trim() || 'Mục tiêu tiết kiệm', parsed);
      setEditingGoal(false);
    } catch (err) {
      setGoalError(err instanceof Error ? err.message : 'Không thể cập nhật mục tiêu.');
    } finally {
      setSavingGoal(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-44 rounded-3xl bg-slate-200" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="h-28 rounded-2xl bg-slate-200" />
          <div className="h-28 rounded-2xl bg-slate-200" />
          <div className="h-28 rounded-2xl bg-slate-200" />
        </div>
        <div className="h-72 rounded-2xl bg-slate-200" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Hero Net Balance Card */}
      <section className="rounded-3xl bg-slate-900 text-white p-6 sm:p-8 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <div className="text-sm font-medium text-slate-300">Tổng số dư ròng hiện có</div>
          <div className="mt-2 font-display text-3xl sm:text-4xl font-extrabold tracking-tight text-white">
            <MoneyText amount={summary.netBalance} />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs sm:text-sm text-slate-300">
            <span>
              Tổng nạp <MoneyText amount={summary.totalDeposits} className="text-emerald-300 font-semibold" />
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Tổng rút <MoneyText amount={summary.totalWithdrawals} className="text-rose-300 font-semibold" />
            </span>
            <span aria-hidden="true">·</span>
            <span>{transactions.length} giao dịch</span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => onNavigate('scan')}
          className="self-start md:self-center px-5 py-3.5 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-sm flex items-center gap-2.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Camera className="w-4 h-4 shrink-0" />
          <span>Quét tờ tiền hoặc Nạp nhanh</span>
        </button>
      </section>

      {/* KPI Row: Today, Month, Goal */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200/90 rounded-2xl p-5">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-medium">Nạp hôm nay</span>
            <TrendingUp className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="mt-2 font-display text-2xl font-bold text-slate-900">
            <MoneyText amount={summary.todayDeposits} />
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Rút hôm nay: <MoneyText amount={summary.todayWithdrawals} />
          </div>
        </div>

        <div className="bg-white border border-slate-200/90 rounded-2xl p-5">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-medium">Nạp tháng này</span>
            <Calendar className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="mt-2 font-display text-2xl font-bold text-slate-900">
            <MoneyText amount={summary.monthDeposits} />
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Rút tháng này: <MoneyText amount={summary.monthWithdrawals} />
          </div>
        </div>

        <div className="bg-white border border-slate-200/90 rounded-2xl p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-slate-700 min-w-0">
                <Target className="w-4 h-4 text-emerald-600 shrink-0" />
                <span className="text-xs font-semibold truncate">{goal.title}</span>
              </div>
              <button
                type="button"
                onClick={openEditGoal}
                aria-label="Sửa mục tiêu tiết kiệm"
                className="px-2.5 py-1 rounded-lg text-xs font-medium text-emerald-700 hover:bg-emerald-50 flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Pencil className="w-3 h-3" />
                <span>Sửa</span>
              </button>
            </div>

            <div className="mt-2 flex items-baseline justify-between gap-2">
              <MoneyText amount={goal.targetAmount} className="font-display text-xl font-bold text-slate-900" />
              <span className="font-mono tabular-nums text-xs font-semibold text-emerald-700">
                {progressPct}%
              </span>
            </div>
          </div>

          <div className="mt-3 space-y-1.5">
            <div className="w-full h-2.5 rounded-full bg-slate-100 overflow-hidden">
              <div
                className="h-full rounded-full bg-emerald-600 transition-all duration-300"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <div className="text-[11px] text-slate-500 flex flex-wrap items-center justify-between gap-2">
              {summary.netBalance >= goal.targetAmount ? (
                <span className="text-emerald-700 font-medium">
                  Đã vượt mục tiêu +<MoneyText amount={summary.netBalance - goal.targetAmount} />
                </span>
              ) : (
                <>
                  <span>
                    Còn thiếu <MoneyText amount={remainingToGoal} className="font-medium text-slate-700" />
                  </span>
                  {estDaysToGoal !== null && (
                    <span className="text-emerald-700 font-medium whitespace-nowrap">
                      ~{estDaysToGoal} ngày nữa đạt
                    </span>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Inline Goal Editor */}
      {editingGoal && (
        <form
          ref={goalFormRef}
          onSubmit={handleSaveGoal}
          className="bg-white border border-emerald-200 rounded-2xl p-5 space-y-4"
        >
          <div className="flex items-center justify-between">
            <h3 className="font-display text-base font-bold text-slate-900">
              Cập nhật mục tiêu tiết kiệm
            </h3>
          </div>
          {goalError && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
              {goalError}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="goal-title-input" className="block text-xs font-medium text-slate-700 mb-1">
                Tên mục tiêu
              </label>
              <input
                id="goal-title-input"
                type="text"
                required
                value={goalTitle}
                onChange={(e) => setGoalTitle(e.target.value)}
                className="w-full h-11 px-3.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>
            <div>
              <label htmlFor="goal-amount-input" className="block text-xs font-medium text-slate-700 mb-1">
                Số tiền mục tiêu (VNĐ)
              </label>
              <input
                id="goal-amount-input"
                type="text"
                inputMode="numeric"
                required
                value={goalTargetInput}
                onChange={(e) => setGoalTargetInput(e.target.value.replace(/[^\d]/g, ''))}
                className="w-full h-11 px-3.5 rounded-xl border border-slate-300 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditingGoal(false)}
              className="px-4 py-2 rounded-xl border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={savingGoal}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-sm font-semibold cursor-pointer"
            >
              {savingGoal ? 'Đang lưu...' : 'Lưu mục tiêu'}
            </button>
          </div>
        </form>
      )}

      {/* SVG Growth Chart */}
      <GrowthChartSvg dailySeries={summary.dailySeries} monthlySeries={summary.monthlySeries} />

      {/* Bottom Split: Recent Transactions & Denomination Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Transactions */}
        <div className="bg-white border border-slate-200/90 rounded-2xl p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h3 className="font-display text-base font-bold text-slate-900">Giao dịch gần đây</h3>
            <button
              type="button"
              onClick={() => onNavigate('history')}
              className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 flex items-center gap-1 whitespace-nowrap cursor-pointer"
            >
              <span>Xem tất cả</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {recentTx.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm text-slate-500">Chưa có giao dịch nào được ghi nhận.</p>
              <button
                type="button"
                onClick={() => onNavigate('scan')}
                className="mt-3 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer"
              >
                Nạp khoản đầu tiên
              </button>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {recentTx.map((tx) => {
                const isWithdraw = tx.type === 'withdraw';
                const dt = new Date(tx.createdAt);
                const dateStr = Number.isNaN(dt.getTime())
                  ? ''
                  : dt.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
                return (
                  <div key={tx.id} className="py-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                          isWithdraw
                            ? 'bg-rose-50 text-rose-600'
                            : 'bg-emerald-50 text-emerald-700'
                        }`}
                      >
                        {isWithdraw ? (
                          <ArrowUpRight className="w-4 h-4" />
                        ) : (
                          <ArrowDownLeft className="w-4 h-4" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-slate-900 truncate">
                          {tx.note || (isWithdraw ? 'Rút tiền mặt' : 'Nạp tiền tiết kiệm')}
                        </div>
                        <div className="text-xs text-slate-500 truncate">
                          {tx.method === 'ai_scan' ? 'Quét AI' : 'Thủ công'}
                          {dateStr ? ` · ${dateStr}` : ''}
                          {tx.serialNumber ? ` · Seri ${tx.serialNumber}` : ''}
                        </div>
                      </div>
                    </div>

                    <MoneyText
                      amount={tx.amount}
                      signed
                      isWithdraw={isWithdraw}
                      className={`text-sm font-semibold shrink-0 ${
                        isWithdraw ? 'text-rose-600' : 'text-emerald-700'
                      }`}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Denomination Breakdown */}
        <div className="bg-white border border-slate-200/90 rounded-2xl p-5 sm:p-6">
          <h3 className="font-display text-base font-bold text-slate-900 mb-1">
            Phân bổ theo mệnh giá
          </h3>
          <p className="text-xs text-slate-500 mb-4">
            Thống kê các tờ tiền có chọn mệnh giá khi nạp hoặc rút
          </p>

          {summary.denominationBreakdown.length === 0 ? (
            <div className="py-8 text-center text-sm text-slate-500">
              Chưa có dữ liệu mệnh giá tờ tiền.
            </div>
          ) : (
            <div className="space-y-3">
              {summary.denominationBreakdown.map((item) => {
                const widthPct = Math.max(
                  6,
                  Math.round((Math.abs(item.totalAmount) / maxDenomAmount) * 100),
                );
                return (
                  <div key={item.denomination}>
                    <div className="flex items-center justify-between text-xs mb-1 gap-2">
                      <span className="font-semibold text-slate-800">
                        <MoneyText amount={item.denomination} />
                        <span className="text-slate-500 font-normal ml-2">
                          {item.netCount} tờ ròng
                        </span>
                      </span>
                      <MoneyText amount={item.totalAmount} className="text-slate-700 font-medium" />
                    </div>
                    <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          item.totalAmount >= 0 ? 'bg-emerald-500' : 'bg-rose-400'
                        }`}
                        style={{ width: `${widthPct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
