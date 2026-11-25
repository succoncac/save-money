export const VND_DENOMINATIONS = [
  500000,
  200000,
  100000,
  50000,
  20000,
  10000,
  5000,
  2000,
  1000,
] as const;

export function formatVnd(amount: number): string {
  const safe = Number.isFinite(amount) ? Math.trunc(amount) : 0;
  const isNegative = safe < 0;
  const abs = Math.abs(safe);
  const formatted = abs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${isNegative ? '-' : ''}${formatted} ₫`;
}

export function formatVndCompact(amount: number): string {
  const safe = Number.isFinite(amount) ? Math.trunc(amount) : 0;
  const abs = Math.abs(safe);
  const sign = safe < 0 ? '-' : '';
  if (abs >= 1_000_000_000) {
    return `${sign}${(abs / 1_000_000_000).toFixed(1).replace(/\.0$/, '')} tỷ`;
  }
  if (abs >= 1_000_000) {
    return `${sign}${(abs / 1_000_000).toFixed(1).replace(/\.0$/, '')} tr`;
  }
  if (abs >= 1_000) {
    return `${sign}${Math.round(abs / 1_000)}k`;
  }
  return `${safe} ₫`;
}

export function parseVndInput(raw: string | number): number | null {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return null;
    const intVal = Math.trunc(raw);
    return intVal > 0 ? intVal : null;
  }
  const cleaned = raw.replace(/[^\d]/g, '');
  if (!cleaned) return null;
  const parsed = Number.parseInt(cleaned, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

export function resolveDenominationForAmount(amount: number): number | null {
  if (!Number.isSafeInteger(amount) || amount <= 0) return null;
  return (VND_DENOMINATIONS as readonly number[]).includes(amount) ? amount : null;
}

