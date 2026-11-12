/** P(X >= k) for X ~ Poisson(lambda). k is a non-negative integer. */
export function poissonAtLeast(k: number, lambda: number): number {
  if (!Number.isFinite(lambda) || lambda < 0) return Number.NaN;
  if (k <= 0) return 1;
  if (lambda === 0) return 0;

  const lam = Math.min(lambda, 40);
  let term = Math.exp(-lam);
  let cdf = term;
  for (let i = 1; i < k; i += 1) {
    term *= lam / i;
    cdf += term;
    if (cdf >= 1) return 0;
  }
  const probability = 1 - cdf;
  if (probability <= 0) return 0;
  if (probability >= 1) return 1;
  return probability;
}
