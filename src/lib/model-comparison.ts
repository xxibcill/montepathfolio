export type ComparisonDirection = "favorable" | "adverse" | "neutral";

export function comparisonDirection(
  value: number | null,
  lowerIsBetter = false,
): ComparisonDirection {
  if (value === null || value === 0) return "neutral";
  const isFavorable = lowerIsBetter ? value < 0 : value > 0;
  return isFavorable ? "favorable" : "adverse";
}
