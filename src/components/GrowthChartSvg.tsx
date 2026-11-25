import { useState } from 'react';
import type { CashflowPoint } from '../utils/cashflow';
import { formatVnd, formatVndCompact } from '../utils/currency';

interface GrowthChartSvgProps {
  dailySeries: CashflowPoint[];
  monthlySeries: CashflowPoint[];
}

export function GrowthChartSvg({ dailySeries, monthlySeries }: GrowthChartSvgProps) {
  const [mode, setMode] = useState<'daily' | 'monthly'>('daily');
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const points = mode === 'daily' ? dailySeries : monthlySeries;
  const width = 680;
  const height = 240;
  const padLeft = 56;
  const padRight = 18;
  const padTop = 20;
  const padBottom = 34;

  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const maxBar = Math.max(100000, ...points.map((p) => Math.max(0, p.barAmount)));
  const cumValues = points.map((p) => p.cumulativeBalance);
  const minLine = Math.min(0, ...cumValues);
  const maxLine = Math.max(100000, ...cumValues);
  const lineRange = Math.max(1, maxLine - minLine);

  const slotW = points.length > 0 ? plotW / points.length : plotW;
  const barW = Math.max(8, Math.min(26, slotW * 0.48));

  const lineCoords = points.map((p, idx) => {
    const x = padLeft + slotW * idx + slotW / 2;
    const y = padTop + plotH - ((p.cumulativeBalance - minLine) / lineRange) * plotH;
    return { x, y };
  });

  const linePath = lineCoords
    .map((pt, idx) => `${idx === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`)
    .join(' ');

  const areaPath =
    lineCoords.length > 0
      ? `${linePath} L ${lineCoords[lineCoords.length - 1].x.toFixed(1)} ${(padTop + plotH).toFixed(1)} L ${lineCoords[0].x.toFixed(1)} ${(padTop + plotH).toFixed(1)} Z`
      : '';

  const activePoint = hoverIdx !== null && points[hoverIdx] ? points[hoverIdx] : null;
  const periodNet = points.reduce((acc, p) => acc + p.netChange, 0);

  return (
    <div className="bg-white border border-slate-200/90 rounded-2xl p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h3 className="font-display text-base font-bold text-slate-900">Biểu đồ tăng trưởng</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Đường tổng lũy kế và cột dòng tiền theo {mode === 'daily' ? '14 ngày gần nhất' : '6 tháng gần nhất'}
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl" role="tablist" aria-label="Chế độ biểu đồ">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'daily'}
            onClick={() => {
              setMode('daily');
              setHoverIdx(null);
            }}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              mode === 'daily'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Theo ngày
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'monthly'}
            onClick={() => {
              setMode('monthly');
              setHoverIdx(null);
            }}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              mode === 'monthly'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Theo tháng
          </button>
        </div>
      </div>

      {/* Selected point readout */}
      <div className="min-h-[28px] mb-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-slate-600">
        {activePoint ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="font-semibold text-slate-900">{activePoint.label}</span>
            <span>
              Nạp:{' '}
              <span className="font-mono tabular-nums font-semibold text-emerald-700 whitespace-nowrap">
                {formatVnd(activePoint.depositAmount)}
              </span>
            </span>
            {activePoint.withdrawAmount > 0 && (
              <span>
                Rút:{' '}
                <span className="font-mono tabular-nums font-semibold text-red-600 whitespace-nowrap">
                  {formatVnd(activePoint.withdrawAmount)}
                </span>
              </span>
            )}
            <span>
              Lũy kế:{' '}
              <span className="font-mono tabular-nums font-semibold text-slate-900 whitespace-nowrap">
                {formatVnd(activePoint.cumulativeBalance)}
              </span>
            </span>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 w-full">
            <div className="flex items-center gap-4 text-xs text-slate-500">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-0.5 bg-emerald-600 inline-block" />
                Tổng lũy kế
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-emerald-200 inline-block" />
                Dòng tiền trong kỳ
              </span>
            </div>
            <span className="text-xs text-slate-500">
              Biến động {mode === 'daily' ? '14 ngày' : '6 tháng'}:{' '}
              <span
                className={`font-mono tabular-nums font-semibold whitespace-nowrap ${
                  periodNet >= 0 ? 'text-emerald-700' : 'text-rose-600'
                }`}
              >
                {periodNet > 0 ? '+' : ''}
                {formatVnd(periodNet)}
              </span>
            </span>
          </div>
        )}
      </div>

      <div className="w-full overflow-hidden">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto select-none"
          role="img"
          aria-label="Biểu đồ tăng trưởng số dư tiết kiệm VNĐ"
        >
          <defs>
            <linearGradient id="vtkAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#059669" stopOpacity="0.18" />
              <stop offset="100%" stopColor="#059669" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Horizontal gridlines */}
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
            const y = padTop + plotH * (1 - ratio);
            const val = minLine + lineRange * ratio;
            return (
              <g key={ratio}>
                <line
                  x1={padLeft}
                  y1={y}
                  x2={width - padRight}
                  y2={y}
                  stroke="#e2e8f0"
                  strokeDasharray="3 3"
                  strokeWidth="1"
                />
                <text
                  x={padLeft - 8}
                  y={y + 4}
                  textAnchor="end"
                  fontSize="10"
                  fill="#64748b"
                  fontFamily="JetBrains Mono, monospace"
                >
                  {formatVndCompact(val)}
                </text>
              </g>
            );
          })}

          {/* Area under cumulative curve */}
          {areaPath && <path d={areaPath} fill="url(#vtkAreaGrad)" />}

          {/* Daily / monthly flow bars (always non-negative height via Math.abs) */}
          {points.map((p, idx) => {
            const safeVal = Math.abs(p.barAmount);
            const rawH = (safeVal / maxBar) * (plotH * 0.75);
            const barH = safeVal > 0 ? Math.max(3, rawH) : 0;
            const x = padLeft + slotW * idx + (slotW - barW) / 2;
            const y = padTop + plotH - barH;
            const isActive = hoverIdx === idx;
            const isWithdrawDominant = p.withdrawAmount > p.depositAmount;
            return (
              <g key={p.key}>
                <rect
                  x={x}
                  y={y}
                  width={barW}
                  height={Math.max(0, barH)}
                  rx={3}
                  fill={
                    isWithdrawDominant
                      ? isActive
                        ? '#ef4444'
                        : '#fecaca'
                      : isActive
                        ? '#10b981'
                        : '#a7f3d0'
                  }
                />
              </g>
            );
          })}

          {/* Cumulative line */}
          {linePath && (
            <path
              d={linePath}
              fill="none"
              stroke="#059669"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Points & X-axis labels & interactive hover hitboxes */}
          {points.map((p, idx) => {
            const coord = lineCoords[idx];
            const showLabel =
              mode === 'monthly' || idx % 2 === 0 || idx === points.length - 1;
            const isActive = hoverIdx === idx;
            return (
              <g
                key={p.key}
                tabIndex={0}
                role="button"
                aria-label={`${p.label}: Nạp ${formatVnd(p.depositAmount)}, Rút ${formatVnd(p.withdrawAmount)}, Lũy kế ${formatVnd(p.cumulativeBalance)}`}
                onMouseEnter={() => setHoverIdx(idx)}
                onMouseLeave={() => setHoverIdx(null)}
                onFocus={() => setHoverIdx(idx)}
                onBlur={() => setHoverIdx(null)}
                onClick={() => setHoverIdx(idx === hoverIdx ? null : idx)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setHoverIdx(idx === hoverIdx ? null : idx);
                  }
                }}
                className="cursor-pointer focus:outline-none"
              >
                <rect
                  x={padLeft + slotW * idx}
                  y={padTop}
                  width={slotW}
                  height={plotH + padBottom}
                  fill="transparent"
                />
                <circle
                  cx={coord.x}
                  cy={coord.y}
                  r={isActive ? 5 : 3}
                  fill={isActive ? '#059669' : '#ffffff'}
                  stroke="#059669"
                  strokeWidth="2"
                />
                {showLabel && (
                  <text
                    x={coord.x}
                    y={height - 10}
                    textAnchor="middle"
                    fontSize="10"
                    fill={isActive ? '#0f172a' : '#64748b'}
                    fontWeight={isActive ? '700' : '500'}
                  >
                    {p.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
