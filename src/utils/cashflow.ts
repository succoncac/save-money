import type { WalletTransaction } from '../types';
import { VND_DENOMINATIONS } from './currency';

export interface CashflowPoint {
  key: string;
  label: string;
  depositAmount: number;
  withdrawAmount: number;
  barAmount: number;
  netChange: number;
  cumulativeBalance: number;
}

export interface DenominationSummary {
  denomination: number;
  depositCount: number;
  withdrawCount: number;
  netCount: number;
  totalAmount: number;
}

export interface CashflowSummary {
  netBalance: number;
  totalDeposits: number;
  totalWithdrawals: number;
  todayDeposits: number;
  todayWithdrawals: number;
  monthDeposits: number;
  monthWithdrawals: number;
  dailySeries: CashflowPoint[];
  monthlySeries: CashflowPoint[];
  denominationBreakdown: DenominationSummary[];
}

function toLocalDayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function toLocalMonthKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function parseTxDate(iso: string): Date {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

export function computeCashflowSummary(
  transactions: WalletTransaction[],
  now: Date = new Date(),
  daysCount: number = 14,
  monthsCount: number = 6,
): CashflowSummary {
  const todayKey = toLocalDayKey(now);
  const monthKey = toLocalMonthKey(now);

  let totalDeposits = 0;
  let totalWithdrawals = 0;
  let todayDeposits = 0;
  let todayWithdrawals = 0;
  let monthDeposits = 0;
  let monthWithdrawals = 0;

  const dailyBuckets = new Map<string, { dep: number; wd: number }>();
  const monthlyBuckets = new Map<string, { dep: number; wd: number }>();
  const denomMap = new Map<number, { depCount: number; wdCount: number; totalAmount: number }>();

  for (const denom of VND_DENOMINATIONS) {
    denomMap.set(denom, { depCount: 0, wdCount: 0, totalAmount: 0 });
  }

  const sorted = [...transactions].sort(
    (a, b) => parseTxDate(a.createdAt).getTime() - parseTxDate(b.createdAt).getTime(),
  );

  for (const tx of sorted) {
    const amount = Math.max(0, Math.trunc(tx.amount));
    const dt = parseTxDate(tx.createdAt);
    const dKey = toLocalDayKey(dt);
    const mKey = toLocalMonthKey(dt);

    const dBucket = dailyBuckets.get(dKey) ?? { dep: 0, wd: 0 };
    const mBucket = monthlyBuckets.get(mKey) ?? { dep: 0, wd: 0 };

    if (tx.type === 'deposit') {
      totalDeposits += amount;
      dBucket.dep += amount;
      mBucket.dep += amount;
      if (dKey === todayKey) todayDeposits += amount;
      if (mKey === monthKey) monthDeposits += amount;
    } else {
      totalWithdrawals += amount;
      dBucket.wd += amount;
      mBucket.wd += amount;
      if (dKey === todayKey) todayWithdrawals += amount;
      if (mKey === monthKey) monthWithdrawals += amount;
    }

    dailyBuckets.set(dKey, dBucket);
    monthlyBuckets.set(mKey, mBucket);

    if (tx.denomination && denomMap.has(tx.denomination)) {
      const entry = denomMap.get(tx.denomination)!;
      if (tx.type === 'deposit') {
        entry.depCount += 1;
        entry.totalAmount += tx.denomination;
      } else {
        entry.wdCount += 1;
        entry.totalAmount -= tx.denomination;
      }
    }
  }

  // Build daily series for the last N days ending at `now`
  const dailyKeys: { key: string; label: string }[] = [];
  for (let i = daysCount - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const key = toLocalDayKey(d);
    const label = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
    dailyKeys.push({ key, label });
  }

  const firstDayKey = dailyKeys[0]?.key ?? todayKey;
  let baselineBeforeDaily = 0;
  for (const [k, b] of dailyBuckets.entries()) {
    if (k < firstDayKey) {
      baselineBeforeDaily += b.dep - b.wd;
    }
  }

  let runningDaily = baselineBeforeDaily;
  const dailySeries: CashflowPoint[] = dailyKeys.map(({ key, label }) => {
    const b = dailyBuckets.get(key) ?? { dep: 0, wd: 0 };
    const netChange = b.dep - b.wd;
    runningDaily += netChange;
    // Use Math.abs on barAmount so days with withdrawals never yield negative SVG rect height
    const barAmount = Math.abs(b.dep > 0 ? b.dep : netChange);
    return {
      key,
      label,
      depositAmount: b.dep,
      withdrawAmount: b.wd,
      barAmount,
      netChange,
      cumulativeBalance: runningDaily,
    };
  });

  // Build monthly series for the last M months ending at `now`
  const monthlyKeys: { key: string; label: string }[] = [];
  for (let i = monthsCount - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = toLocalMonthKey(d);
    const label = `T${d.getMonth() + 1}/${String(d.getFullYear()).slice(-2)}`;
    monthlyKeys.push({ key, label });
  }

  const firstMonthKey = monthlyKeys[0]?.key ?? monthKey;
  let baselineBeforeMonthly = 0;
  for (const [k, b] of monthlyBuckets.entries()) {
    if (k < firstMonthKey) {
      baselineBeforeMonthly += b.dep - b.wd;
    }
  }

  let runningMonthly = baselineBeforeMonthly;
  const monthlySeries: CashflowPoint[] = monthlyKeys.map(({ key, label }) => {
    const b = monthlyBuckets.get(key) ?? { dep: 0, wd: 0 };
    const netChange = b.dep - b.wd;
    runningMonthly += netChange;
    const barAmount = Math.abs(b.dep > 0 ? b.dep : netChange);
    return {
      key,
      label,
      depositAmount: b.dep,
      withdrawAmount: b.wd,
      barAmount,
      netChange,
      cumulativeBalance: runningMonthly,
    };
  });

  const denominationBreakdown: DenominationSummary[] = [];
  for (const denom of VND_DENOMINATIONS) {
    const entry = denomMap.get(denom)!;
    if (entry.depCount > 0 || entry.wdCount > 0) {
      denominationBreakdown.push({
        denomination: denom,
        depositCount: entry.depCount,
        withdrawCount: entry.wdCount,
        netCount: entry.depCount - entry.wdCount,
        totalAmount: entry.totalAmount,
      });
    }
  }

  return {
    netBalance: totalDeposits - totalWithdrawals,
    totalDeposits,
    totalWithdrawals,
    todayDeposits,
    todayWithdrawals,
    monthDeposits,
    monthWithdrawals,
    dailySeries,
    monthlySeries,
    denominationBreakdown,
  };
}
