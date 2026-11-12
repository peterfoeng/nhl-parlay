export function round(value: number, places = 6): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

export function formatPercent(probability: number, digits = 1): string {
  return `${(probability * 100).toFixed(digits)}%`;
}

export function formatDecimal(odds: number): string {
  return odds.toFixed(2);
}

export function formatEdge(value: number): string {
  const points = value * 100;
  const sign = points > 0 ? "+" : "";
  return `${sign}${points.toFixed(1)} pp`;
}

export function formatUnits(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}u`;
}

export function sourceLabel(source: string | null): string {
  if (!source) return "no price";
  if (source === "sportsbet") return "Sportsbet";
  if (source === "pointsbet") return "PointsBet";
  if (source.startsWith("oddsapi:")) return `The Odds API (${source.slice("oddsapi:".length)})`;
  return source;
}

export function dataFooter(sources: Array<string | null>): string {
  const labels = [...new Set(sources.filter((source): source is string => Boolean(source)).map((source) => sourceLabel(source)))];
  const odds = labels.length ? labels.join(", ") : "no odds source returned a price";
  return `Model probabilities, not advice. Data: NHL API, MoneyPuck.com, ${odds}.`;
}
