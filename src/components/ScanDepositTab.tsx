import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  Camera,
  Upload,
  CheckCircle2,
  ShieldAlert,
  Sparkles,
  X,
  ArrowDownLeft,
  ArrowUpRight,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react';
import { api, ApiError } from '../api/client';
import type { AuthUser, BillScanResult, TransactionType, WalletTransaction } from '../types';
import { VND_DENOMINATIONS, parseVndInput } from '../utils/currency';
import { normalizeSerial } from '../utils/serial';
import { computeCashflowSummary } from '../utils/cashflow';
import { MoneyText } from './MoneyText';

interface ScanDepositTabProps {
  user: AuthUser;
  transactions: WalletTransaction[];
  onTransactionCreated: () => Promise<void>;
}

export function ScanDepositTab({ user, transactions, onTransactionCreated }: ScanDepositTabProps) {
  const [txType, setTxType] = useState<TransactionType>('deposit');
  const [amountInput, setAmountInput] = useState('');
  const [selectedDenom, setSelectedDenom] = useState<number | null>(null);
  const [serialInput, setSerialInput] = useState('');
  const [noteInput, setNoteInput] = useState('');
  const [method, setMethod] = useState<'manual' | 'ai_scan'>('manual');
  const [aiConfidence, setAiConfidence] = useState<number | null>(null);

  // Camera & AI scan states
  const [cameraActive, setCameraActive] = useState(false);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<BillScanResult | null>(null);
  const [previewImg, setPreviewImg] = useState<string | null>(null);

  // Submit & Anti-theft alert states
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [antiTheftWarning, setAntiTheftWarning] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const canCamera = user.canUseCamera || user.role === 'admin';

  useEffect(() => {
    if (cameraActive && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [cameraActive]);

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  function stopCamera() {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  }

  async function startCamera(targetFacing: 'environment' | 'user' = facingMode) {
    setCameraError(null);
    setAntiTheftWarning(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Trình duyệt không hỗ trợ mở camera trực tiếp. Hãy dùng nút tải ảnh lên.');
      return;
    }
    stopCamera();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: targetFacing } },
        audio: false,
      });
      streamRef.current = stream;
      setFacingMode(targetFacing);
      setCameraActive(true);
    } catch {
      setCameraError('Không thể truy cập camera. Hãy cấp quyền hoặc tải ảnh tờ tiền từ máy.');
    }
  }

  function handleFlipCamera() {
    if (scanning) return;
    const nextFacing = facingMode === 'environment' ? 'user' : 'environment';
    void startCamera(nextFacing);
  }

  async function runAiBillScan(dataUrl: string) {
    setScanning(true);
    setCameraError(null);
    setAntiTheftWarning(null);
    setSuccessMsg(null);
    setPreviewImg(dataUrl);
    try {
      const result = await api.scanBill(dataUrl);
      setScanResult(result);
      if (result.denomination) {
        setSelectedDenom(result.denomination);
        setAmountInput(String(result.denomination));
      }
      if (result.serialNumber) {
        setSerialInput(result.serialNumber);
      }
      setMethod('ai_scan');
      setAiConfidence(result.confidence);
      if (!noteInput.trim() && result.denomination) {
        setNoteInput(`Quét AI tờ ${result.denomination.toLocaleString('vi-VN')} ₫`);
      }
      if (result.serialConflict?.isConflict) {
        setAntiTheftWarning(result.serialConflict.message);
      }
    } catch (err) {
      setCameraError(err instanceof Error ? err.message : 'Lỗi quét tờ tiền bằng AI.');
    } finally {
      setScanning(false);
    }
  }

  function captureCameraFrame() {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement('canvas');
    const w = video.videoWidth || 1280;
    const h = video.videoHeight || 720;
    const scale = Math.min(1, 1280 / Math.max(w, h));
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.86);
    stopCamera();
    void runAiBillScan(dataUrl);
  }

  function compressImageFile(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Không thể đọc file ảnh.'));
      reader.onload = () => {
        const rawDataUrl = typeof reader.result === 'string' ? reader.result : '';
        if (!rawDataUrl) {
          reject(new Error('Dữ liệu ảnh trống.'));
          return;
        }
        const img = new Image();
        img.onload = () => {
          const maxSide = 1400;
          const w = img.naturalWidth || img.width;
          const h = img.naturalHeight || img.height;
          if (!w || !h) {
            resolve(rawDataUrl);
            return;
          }
          const scale = Math.min(1, maxSide / Math.max(w, h));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(w * scale));
          canvas.height = Math.max(1, Math.round(h * scale));
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(rawDataUrl);
            return;
          }
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.86));
        };
        img.onerror = () => resolve(rawDataUrl);
        img.src = rawDataUrl;
      };
      reader.readAsDataURL(file);
    });
  }

  async function handleFileSelected(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    stopCamera();
    try {
      const compressed = await compressImageFile(file);
      await runAiBillScan(compressed);
    } catch (err) {
      setCameraError(err instanceof Error ? err.message : 'Không thể xử lý ảnh đã chọn.');
    }
  }

  function handlePickDenom(denom: number) {
    setSelectedDenom(denom);
    setAmountInput(String(denom));
    setSubmitError(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    setAntiTheftWarning(null);
    setSuccessMsg(null);

    const parsedAmount = parseVndInput(amountInput);
    if (!parsedAmount) {
      setSubmitError('Vui lòng nhập số tiền hợp lệ (số nguyên dương VNĐ).');
      return;
    }

    setSubmitting(true);
    try {
      await api.createTransaction({
        type: txType,
        amount: parsedAmount,
        denomination: selectedDenom,
        serialNumber: serialInput.trim() || null,
        method,
        note: noteInput.trim(),
        aiConfidence,
      });

      setSuccessMsg(
        txType === 'deposit'
          ? 'Đã nạp tiền vào ví thành công.'
          : 'Đã ghi nhận khoản rút tiền.',
      );
      setAmountInput('');
      setSelectedDenom(null);
      setSerialInput('');
      setNoteInput('');
      setMethod('manual');
      setAiConfidence(null);
      setScanResult(null);
      setPreviewImg(null);
      await onTransactionCreated();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'SERIAL_CONFLICT') {
        setAntiTheftWarning(err.message);
      } else {
        setSubmitError(err instanceof Error ? err.message : 'Không thể lưu giao dịch.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Anti-Theft Red Warning Banner */}
      {antiTheftWarning && (
        <div
          role="alert"
          className="lg:col-span-12 rounded-2xl border-2 border-red-500 bg-red-50 p-5 flex items-start gap-3.5 text-red-950"
        >
          <ShieldAlert className="w-6 h-6 text-red-600 shrink-0 mt-0.5" />
          <div>
            <h3 className="font-display text-base font-bold text-red-900">
              Giao dịch bị chặn — Cảnh báo chống lấy tiền
            </h3>
            <p className="mt-1 text-sm text-red-800 leading-relaxed">{antiTheftWarning}</p>
          </div>
        </div>
      )}

      {/* Left: AI Camera Scanner */}
      <div className="lg:col-span-5 bg-white border border-slate-200/90 rounded-2xl p-5 sm:p-6 flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-lg font-bold text-slate-900">Quét tờ tiền AI</h2>
            <Sparkles className="w-4 h-4 text-emerald-600" />
          </div>
          <p className="mt-1 text-xs text-slate-500 leading-relaxed">
            Chụp hoặc tải ảnh tờ tiền VNĐ để AI tự động nhận diện mệnh giá và số seri chống trùng lặp.
          </p>

          {!canCamera ? (
            <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-600">
              Quyền sử dụng Camera / Quét tờ tiền AI của tài khoản này đang được quản trị viên tắt. Bạn vẫn có thể nạp/rút thủ công ở khung bên cạnh.
            </div>
          ) : (
            <div className="mt-5 space-y-4">
              {cameraActive ? (
                <div className="relative rounded-2xl overflow-hidden bg-slate-950 aspect-[4/3]">
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover"
                  />
                  {/* Framing guide overlay */}
                  <div className="pointer-events-none absolute inset-4 border-2 border-dashed border-emerald-400/75 rounded-xl flex items-start justify-center pt-2">
                    <span className="px-2.5 py-0.5 rounded-md bg-slate-950/70 text-[11px] font-medium text-emerald-200">
                      Căn tờ tiền vào khung, rõ số seri
                    </span>
                  </div>
                  <div className="absolute bottom-3 inset-x-3 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={stopCamera}
                        className="px-3 py-2 rounded-xl bg-slate-900/85 text-white text-xs font-medium flex items-center gap-1.5 cursor-pointer"
                      >
                        <X className="w-4 h-4" />
                        <span>Đóng</span>
                      </button>
                      <button
                        type="button"
                        disabled={scanning}
                        onClick={handleFlipCamera}
                        aria-label="Đổi camera trước/sau"
                        className="px-3 py-2 rounded-xl bg-slate-900/85 text-white text-xs font-medium flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Đổi cam</span>
                      </button>
                    </div>
                    <button
                      type="button"
                      disabled={scanning}
                      onClick={captureCameraFrame}
                      className="px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-slate-950 text-xs font-bold cursor-pointer"
                    >
                      Chụp & Nhận diện
                    </button>
                  </div>
                </div>
              ) : previewImg ? (
                <div className="relative rounded-2xl overflow-hidden border border-slate-200 bg-slate-100 aspect-[4/3]">
                  <img
                    src={previewImg}
                    alt="Ảnh tờ tiền vừa quét"
                    className="w-full h-full object-contain"
                  />
                  <button
                    type="button"
                    aria-label="Xóa ảnh xem trước"
                    onClick={() => {
                      setPreviewImg(null);
                      setScanResult(null);
                    }}
                    className="absolute top-2.5 right-2.5 w-8 h-8 rounded-full bg-slate-900/75 text-white flex items-center justify-center cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 p-8 text-center">
                  <Camera className="w-9 h-9 text-slate-400 mx-auto" />
                  <p className="mt-2.5 text-sm font-medium text-slate-700">
                    Đặt tờ tiền phẳng, đủ sáng và rõ số seri
                  </p>
                </div>
              )}

              {cameraError && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-800">
                  {cameraError}
                </div>
              )}

              {scanning && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-800">
                  Đang phân tích mệnh giá và số seri tờ tiền bằng AI...
                </div>
              )}

              {scanResult && !scanning && (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-1.5 text-xs">
                  <div className="font-semibold text-slate-900">Kết quả nhận diện AI</div>
                  <div className="text-slate-600">
                    Mệnh giá:{' '}
                    {scanResult.denomination ? (
                      <MoneyText amount={scanResult.denomination} className="font-semibold text-emerald-700" />
                    ) : (
                      <span className="text-slate-500">Chưa rõ</span>
                    )}
                  </div>
                  <div className="text-slate-600">
                    Số seri:{' '}
                    <span className="font-mono font-semibold text-slate-900">
                      {scanResult.serialNumber || 'Không đọc được'}
                    </span>
                  </div>
                  <div className="text-slate-500">
                    Độ tin cậy: {Math.round(scanResult.confidence * 100)}% · {scanResult.note}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  disabled={scanning}
                  onClick={() => void startCamera()}
                  className="h-11 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white text-xs font-semibold flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer"
                >
                  <Camera className="w-4 h-4 shrink-0" />
                  <span>Mở camera</span>
                </button>
                <button
                  type="button"
                  disabled={scanning}
                  onClick={() => fileInputRef.current?.click()}
                  className="h-11 px-3 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-60 text-slate-800 text-xs font-semibold flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer"
                >
                  <Upload className="w-4 h-4 shrink-0" />
                  <span>Tải ảnh lên</span>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleFileSelected}
                  className="hidden"
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right: Manual & Confirmed Deposit/Withdraw Form */}
      <div className="lg:col-span-7 bg-white border border-slate-200/90 rounded-2xl p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-lg font-bold text-slate-900">
            Thông tin giao dịch VNĐ
          </h2>

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl">
            <button
              type="button"
              onClick={() => setTxType('deposit')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors ${
                txType === 'deposit'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <ArrowDownLeft className="w-3.5 h-3.5" />
              <span>Nạp tiền</span>
            </button>
            <button
              type="button"
              onClick={() => setTxType('withdraw')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors ${
                txType === 'withdraw'
                  ? 'bg-rose-600 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <ArrowUpRight className="w-3.5 h-3.5" />
              <span>Rút tiền</span>
            </button>
          </div>
        </div>

        {successMsg && (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {submitError && (
          <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {submitError}
          </div>
        )}

        {(() => {
          const norm = normalizeSerial(serialInput);
          const ownDup =
            txType === 'deposit' && norm.length >= 4
              ? transactions.find((t) => t.type === 'deposit' && t.serialNormalized === norm)
              : null;
          const currentBalance = computeCashflowSummary(transactions).netBalance;
          const parsedAmt = parseVndInput(amountInput);
          const overBalance = txType === 'withdraw' && parsedAmt !== null && parsedAmt > currentBalance;

          return (
            <>
              {ownDup && (
                <div
                  role="status"
                  className="mt-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-900 flex items-start gap-2.5"
                >
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold">Cảnh báo trùng trong ví cá nhân:</span> Số seri{' '}
                    <span className="font-mono font-semibold">{ownDup.serialNumber || norm}</span> đã được bạn nạp vào ngày{' '}
                    {new Date(ownDup.createdAt).toLocaleDateString('vi-VN')} (
                    <MoneyText amount={ownDup.amount} className="font-semibold" />). Hãy kiểm tra kỹ để tránh ghi nhận 2 lần cùng 1 tờ tiền.
                  </div>
                </div>
              )}

              {txType === 'withdraw' && (
                <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs text-slate-600 flex flex-wrap items-center justify-between gap-2">
                  <span>
                    Số dư ròng hiện có:{' '}
                    <MoneyText amount={currentBalance} className="font-semibold text-slate-900" />
                  </span>
                  {overBalance && (
                    <span className="font-semibold text-rose-600">
                      Số tiền rút đang vượt quá số dư hiện có
                    </span>
                  )}
                </div>
              )}
            </>
          );
        })()}

        <form onSubmit={handleSubmit} className="mt-5 space-y-5">
          {/* Quick Denomination Picker */}
          <div>
            <span className="block text-xs font-medium text-slate-600 mb-2">
              Chọn nhanh mệnh giá VNĐ
            </span>
            <div className="grid grid-cols-3 gap-2">
              {VND_DENOMINATIONS.map((denom) => {
                const active = selectedDenom === denom;
                return (
                  <button
                    key={denom}
                    type="button"
                    onClick={() => handlePickDenom(denom)}
                    className={`h-10 px-2 rounded-xl border text-xs font-mono font-semibold tabular-nums whitespace-nowrap transition-colors cursor-pointer ${
                      active
                        ? 'border-emerald-600 bg-emerald-50 text-emerald-800'
                        : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    <MoneyText amount={denom} />
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="tx-amount" className="block text-sm font-medium text-slate-700 mb-1.5">
                Số tiền (VNĐ)
              </label>
              <input
                id="tx-amount"
                type="text"
                inputMode="numeric"
                required
                value={amountInput}
                onChange={(e) => {
                  const val = e.target.value.replace(/[^\d]/g, '');
                  setAmountInput(val);
                  if (!val || Number(val) !== selectedDenom) {
                    setSelectedDenom(null);
                  }
                }}
                placeholder="Ví dụ: 500000"
                className="w-full h-11 px-4 rounded-xl border border-slate-300 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
              {parseVndInput(amountInput) && (
                <div className="mt-1 text-xs text-slate-500">
                  Hiển thị: <MoneyText amount={parseVndInput(amountInput)!} className="font-semibold text-slate-800" />
                </div>
              )}
            </div>

            <div>
              <label htmlFor="tx-serial" className="block text-sm font-medium text-slate-700 mb-1.5">
                Số seri tờ tiền (tùy chọn)
              </label>
              <input
                id="tx-serial"
                type="text"
                value={serialInput}
                onChange={(e) => setSerialInput(e.target.value)}
                placeholder="Ví dụ: AB 12345678"
                className="w-full h-11 px-4 rounded-xl border border-slate-300 font-mono text-sm uppercase focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
              <div className="mt-1 text-xs text-slate-500">
                Tự động chuẩn hóa và kiểm tra trùng với tài khoản khác.
              </div>
            </div>
          </div>

          <div>
            <label htmlFor="tx-note" className="block text-sm font-medium text-slate-700 mb-1.5">
              Ghi chú
            </label>
            <input
              id="tx-note"
              type="text"
              value={noteInput}
              onChange={(e) => setNoteInput(e.target.value)}
              placeholder={txType === 'deposit' ? 'Tiết kiệm hàng ngày, tiền thưởng...' : 'Lý do rút tiền...'}
              className="w-full h-11 px-4 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className={`w-full h-12 rounded-xl text-white font-semibold text-sm transition-colors cursor-pointer disabled:opacity-60 ${
              txType === 'deposit'
                ? 'bg-emerald-600 hover:bg-emerald-700'
                : 'bg-rose-600 hover:bg-rose-700'
            }`}
          >
            {submitting
              ? 'Đang lưu giao dịch...'
              : txType === 'deposit'
                ? 'Xác nhận nạp vào ví'
                : 'Xác nhận rút tiền'}
          </button>
        </form>
      </div>
    </div>
  );
}
