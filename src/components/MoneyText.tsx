import { formatVnd } from '../utils/currency';

interface MoneyTextProps {
  amount: number;
  signed?: boolean;
  isWithdraw?: boolean;
  className?: string;
}

export function MoneyText({ amount, signed = false, isWithdraw = false, className = '' }: MoneyTextProps) {
  const safe = Math.trunc(amount);
  const absFormatted = Math.abs(safe).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const prefix = signed ? (isWithdraw ? '-' : '+') : safe < 0 ? '-' : '';
  return (
    <span className={`whitespace-nowrap font-mono tabular-nums ${className}`}>
      {prefix}
      {absFormatted}
      <span className="font-sans ml-1">₫</span>
    </span>
  );
}
