import { useRef, useState, type FormEvent } from 'react';
import { Search, Pencil, Trash2, ArrowDownLeft, ArrowUpRight, X } from 'lucide-react';
import { api, ApiError } from '../api/client';
import type { TransactionType, WalletTransaction } from '../types';
import { parseVndInput, resolveDenominationForAmount } from '../utils/currency';
import { MoneyText } from './MoneyText';

interface HistoryTabProps {
  transactions: WalletTransaction[];
  loading: boolean;
  onChanged: () => Promise<void>;
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function isSameLocalMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

export function HistoryTab({ transactions, loading, onChanged }: HistoryTabProps) {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'deposit' | 'withdraw'>('all');
  const [methodFilter, setMethodFilter] = useState<'all' | 'manual' | 'ai_scan'>('all');
  const [periodFilter, setPeriodFilter] = useState<'all' | 'today' | 'month'>('all');
  const [onlyWithSerial, setOnlyWithSerial] = useState(false);

  const [editingTx, setEditingTx] = useState<WalletTransaction | null>(null);
  const [editType, setEditType] = useState<TransactionType>('deposit');
  const [editAmount, setEditAmount] = useState('');
  const [editSerial, setEditSerial] = useState('');
  const [editNote, setEditNote] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [busyDelete, setBusyDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const editFormRef = useRef<HTMLFormElement | null>(null);

  const now = new Date();
  const filtered = transactions.filter((tx) => {
    if (typeFilter !== 'all' && tx.type !== typeFilter) return false;
    if (methodFilter !== 'all' && tx.method !== methodFilter) return false;
    if (onlyWithSerial && !tx.serialNumber) return false;
    if (periodFilter !== 'all') {
      const txDate = new Date(tx.createdAt);
      if (Number.isNaN(txDate.getTime())) return false;
      if (periodFilter === 'today' && !isSameLocalDay(txDate, now)) return false;
      if (periodFilter === 'month' && !isSameLocalMonth(txDate, now)) return false;
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const hitNote = tx.note.toLowerCase().includes(q);
      const hitSerial = (tx.serialNumber || '').toLowerCase().includes(q);
      const hitNorm = (tx.serialNormalized || '').toLowerCase().includes(q.replace(/[^a-z0-9]/g, ''));
      const hitAmount = String(tx.amount).includes(q.replace(/[^\d]/g, '') || '__none__');
      if (!hitNote && !hitSerial && !hitNorm && !hitAmount) return false;
    }
    return true;
  });

  const hasActiveFilter = Boolean(
    search.trim() ||
      typeFilter !== 'all' ||
      methodFilter !== 'all' ||
      periodFilter !== 'all' ||
      onlyWithSerial,
  );
  const filteredDeposit = filtered
    .filter((t) => t.type === 'deposit')
    .reduce((acc, t) => acc + t.amount, 0);
  const filteredWithdraw = filtered
    .filter((t) => t.type === 'withdraw')
    .reduce((acc, t) => acc + t.amount, 0);
  const filteredNet = filteredDeposit - filteredWithdraw;

  function startEdit(tx: WalletTransaction) {
    setEditingTx(tx);
    setEditType(tx.type);
    setEditAmount(String(tx.amount));
    setEditSerial(tx.serialNumber || '');
    setEditNote(tx.note || '');
    setEditError(null);
    setDeleteError(null);
    window.setTimeout(() => {
      editFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 30);
  }

  async function handleSaveEdit(e: FormEvent) {
    e.preventDefault();
    if (!editingTx) return;
    setEditError(null);
    const parsed = parseVndInput(editAmount);
    if (!parsed) {
      setEditError('Số tiền phải là số nguyên dương.');
      return;
    }
    setSavingEdit(true);
    try {
      const syncedDenomination = resolveDenominationForAmount(parsed);
      await api.updateTransaction(editingTx.id, {
        type: editType,
        amount: parsed,
        denomination: syncedDenomination,
        serialNumber: editSerial.trim() || null,
        note: editNote.trim(),
      });
      setEditingTx(null);
      await onChanged();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'SERIAL_CONFLICT') {
        setEditError(err.message);
      } else {
        setEditError(err instanceof Error ? err.message : 'Không thể cập nhật giao dịch.');
      }
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleConfirmDelete(id: string) {
    setDeleteError(null);
    setBusyDelete(true);
    try {
      await api.deleteTransaction(id);
      setDeletingId(null);
      await onChanged();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Không thể xóa giao dịch.');
    } finally {
      setBusyDelete(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Search & Filter Toolbar */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-5 flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm theo ghi chú, số seri hoặc số tiền..."
            aria-label="Tìm kiếm giao dịch"
            className="w-full h-11 pl-10 pr-4 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Lọc theo loại giao dịch"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as 'all' | 'deposit' | 'withdraw')}
            className="h-11 px-3.5 rounded-xl border border-slate-300 bg-white text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-600"
          >
            <option value="all">Mọi loại</option>
            <option value="deposit">Chỉ nạp tiền</option>
            <option value="withdraw">Chỉ rút tiền</option>
          </select>

          <select
            aria-label="Lọc theo phương thức"
            value={methodFilter}
            onChange={(e) => setMethodFilter(e.target.value as 'all' | 'manual' | 'ai_scan')}
            className="h-11 px-3.5 rounded-xl border border-slate-300 bg-white text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-600"
          >
            <option value="all">Mọi phương thức</option>
            <option value="ai_scan">Quét AI</option>
            <option value="manual">Nhập thủ công</option>
          </select>

          <select
            aria-label="Lọc theo thời gian"
            value={periodFilter}
            onChange={(e) => setPeriodFilter(e.target.value as 'all' | 'today' | 'month')}
            className="h-11 px-3.5 rounded-xl border border-slate-300 bg-white text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-600"
          >
            <option value="all">Mọi thời gian</option>
            <option value="today">Hôm nay</option>
            <option value="month">Tháng này</option>
          </select>

          <label className="h-11 px-3.5 rounded-xl border border-slate-300 bg-white text-xs font-medium text-slate-700 inline-flex items-center gap-2 cursor-pointer whitespace-nowrap">
            <input
              type="checkbox"
              checked={onlyWithSerial}
              onChange={(e) => setOnlyWithSerial(e.target.checked)}
              className="rounded border-slate-300 text-emerald-600"
            />
            <span>Có số seri</span>
          </label>

          {hasActiveFilter && (
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setTypeFilter('all');
                setMethodFilter('all');
                setPeriodFilter('all');
                setOnlyWithSerial(false);
              }}
              className="h-11 px-3 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-medium text-slate-600 cursor-pointer whitespace-nowrap"
            >
              Đặt lại
            </button>
          )}
        </div>
      </div>

      {deleteError && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 flex items-center justify-between gap-3"
        >
          <span>{deleteError}</span>
          <button
            type="button"
            onClick={() => setDeleteError(null)}
            aria-label="Đóng thông báo lỗi xóa"
            className="text-red-700 hover:text-red-900 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Filtered totals summary */}
      {filtered.length > 0 && (
        <div className="bg-white border border-slate-200/90 rounded-2xl px-5 py-3.5 flex flex-wrap items-center justify-between gap-3 text-xs">
          <span className="font-medium text-slate-600">
            Tổng theo kết quả lọc ({filtered.length} giao dịch)
          </span>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="text-slate-600">
              Nạp: <MoneyText amount={filteredDeposit} className="font-semibold text-emerald-700" />
            </span>
            <span className="text-slate-600">
              Rút: <MoneyText amount={filteredWithdraw} className="font-semibold text-rose-600" />
            </span>
            <span className="text-slate-800 font-semibold">
              Ròng:{' '}
              <MoneyText
                amount={filteredNet}
                className={filteredNet >= 0 ? 'text-emerald-700' : 'text-rose-600'}
              />
            </span>
          </div>
        </div>
      )}

      {/* Edit Modal / Inline Card */}
      {editingTx && (
        <form
          ref={editFormRef}
          onSubmit={handleSaveEdit}
          className="bg-white border border-emerald-300 rounded-2xl p-5 space-y-4"
        >
          <div className="flex items-center justify-between">
            <h3 className="font-display text-base font-bold text-slate-900">Chỉnh sửa giao dịch</h3>
            <button
              type="button"
              onClick={() => setEditingTx(null)}
              aria-label="Đóng khung chỉnh sửa"
              className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-500 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {editError && (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-800">
              {editError}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label htmlFor="edit-tx-type" className="block text-xs font-medium text-slate-600 mb-1">
                Loại
              </label>
              <select
                id="edit-tx-type"
                value={editType}
                onChange={(e) => setEditType(e.target.value as TransactionType)}
                className="w-full h-10 px-3 rounded-xl border border-slate-300 text-sm bg-white"
              >
                <option value="deposit">Nạp tiền</option>
                <option value="withdraw">Rút tiền</option>
              </select>
            </div>
            <div>
              <label htmlFor="edit-tx-amount" className="block text-xs font-medium text-slate-600 mb-1">
                Số tiền (VNĐ)
              </label>
              <input
                id="edit-tx-amount"
                type="text"
                inputMode="numeric"
                required
                value={editAmount}
                onChange={(e) => setEditAmount(e.target.value.replace(/[^\d]/g, ''))}
                className="w-full h-10 px-3 rounded-xl border border-slate-300 font-mono text-sm"
              />
            </div>
            <div>
              <label htmlFor="edit-tx-serial" className="block text-xs font-medium text-slate-600 mb-1">
                Số seri
              </label>
              <input
                id="edit-tx-serial"
                type="text"
                value={editSerial}
                onChange={(e) => setEditSerial(e.target.value)}
                className="w-full h-10 px-3 rounded-xl border border-slate-300 font-mono text-sm uppercase"
              />
            </div>
            <div>
              <label htmlFor="edit-tx-note" className="block text-xs font-medium text-slate-600 mb-1">
                Ghi chú
              </label>
              <input
                id="edit-tx-note"
                type="text"
                value={editNote}
                onChange={(e) => setEditNote(e.target.value)}
                className="w-full h-10 px-3 rounded-xl border border-slate-300 text-sm"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditingTx(null)}
              className="px-4 py-2 rounded-xl border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={savingEdit}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs font-semibold cursor-pointer"
            >
              {savingEdit ? 'Đang lưu...' : 'Lưu thay đổi'}
            </button>
          </div>
        </form>
      )}

      {/* Transactions List */}
      <div className="bg-white border border-slate-200/90 rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="font-display text-base font-bold text-slate-900">
            Lịch sử giao dịch ({filtered.length})
          </h2>
        </div>

        {loading ? (
          <div className="p-6 space-y-3 animate-pulse">
            <div className="h-12 rounded-xl bg-slate-100" />
            <div className="h-12 rounded-xl bg-slate-100" />
            <div className="h-12 rounded-xl bg-slate-100" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">
            Không có giao dịch phù hợp với bộ lọc hiện tại.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filtered.map((tx) => {
              const isWithdraw = tx.type === 'withdraw';
              const dt = new Date(tx.createdAt);
              const dtStr = Number.isNaN(dt.getTime())
                ? tx.createdAt
                : dt.toLocaleString('vi-VN', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  });

              return (
                <div
                  key={tx.id}
                  className="px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/70 transition-colors"
                >
                  <div className="flex items-start sm:items-center gap-3 min-w-0">
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5 sm:mt-0 ${
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
                      <div className="text-xs text-slate-500 flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                        <span>{tx.method === 'ai_scan' ? 'Quét AI' : 'Thủ công'}</span>
                        <span aria-hidden="true">·</span>
                        <span>{dtStr}</span>
                        {tx.serialNumber && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono text-slate-700">Seri {tx.serialNumber}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                    <MoneyText
                      amount={tx.amount}
                      signed
                      isWithdraw={isWithdraw}
                      className={`text-sm font-bold ${
                        isWithdraw ? 'text-rose-600' : 'text-emerald-700'
                      }`}
                    />

                    {deletingId === tx.id ? (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          disabled={busyDelete}
                          onClick={() => void handleConfirmDelete(tx.id)}
                          className="px-2.5 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold cursor-pointer"
                        >
                          Xác nhận xóa
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeletingId(null)}
                          className="px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs text-slate-600 cursor-pointer"
                        >
                          Hủy
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => startEdit(tx)}
                          aria-label={`Sửa giao dịch ${tx.note || tx.amount}`}
                          className="w-9 h-9 rounded-lg hover:bg-slate-200/70 text-slate-600 flex items-center justify-center cursor-pointer"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeletingId(tx.id)}
                          aria-label={`Xóa giao dịch ${tx.note || tx.amount}`}
                          className="w-9 h-9 rounded-lg hover:bg-red-50 text-slate-500 hover:text-red-600 flex items-center justify-center cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
