/** American price to decimal. +150 -> 2.50, -150 -> 1.666.... */
export function americanToDecimal(american: number): number | null {
  if (!Number.isFinite(american) || american === 0) return null;
  if (american > 0) return american / 100 + 1;
  return 100 / Math.abs(american) + 1;
}

/**
 * Accept a decimal price, or an American price when it cannot be a decimal
 * (100 or more, or -100 or less). Rejects anything that is not a real price above 1.
 */
export function toDecimalOdds(price: number): number | null {
  if (!Number.isFinite(price)) return null;
  if (price >= 1.01 && price < 50) return price;
  if (price <= -100 || price >= 100) return americanToDecimal(price);
  return null;
}

export function impliedProbability(decimalOdds: number): number | null {
  if (!(decimalOdds > 1) || !Number.isFinite(decimalOdds)) return null;
  return 1 / decimalOdds;
}

/** Model probability minus implied probability. Positive means the model is above the price. */
export function edge(modelProbability: number, decimalOdds: number): number | null {
  const implied = impliedProbability(decimalOdds);
  if (implied == null || !Number.isFinite(modelProbability)) return null;
  return modelProbability - implied;
}
