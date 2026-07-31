const fullCurrencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const compactCurrencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  compactDisplay: "short",
  maximumFractionDigits: 1,
});

function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value);
}

export function formatCurrency(value: number): string {
  return isFiniteNumber(value) ? fullCurrencyFormatter.format(value) : "—";
}

export function formatCompactCurrency(value: number): string {
  return isFiniteNumber(value) ? compactCurrencyFormatter.format(value) : "—";
}

export function formatPercent(
  value: number,
  maximumFractionDigits = 0,
): string {
  if (!isFiniteNumber(value)) return "—";

  return new Intl.NumberFormat("en-US", {
    style: "percent",
    maximumFractionDigits,
  }).format(value);
}

/** Formats a month-based duration as a compact year/month label. */
export function formatDuration(months: number | null): string {
  if (months === null || !isFiniteNumber(months)) return "—";

  const roundedMonths = Math.max(0, Math.round(months));
  const years = Math.floor(roundedMonths / 12);
  const remainingMonths = roundedMonths % 12;

  if (years === 0) return `${remainingMonths} mo`;
  if (remainingMonths === 0) return `${years} yr`;
  return `${years} yr ${remainingMonths} mo`;
}
