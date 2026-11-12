/**
 * Pick a 3-leg parlay from priced legs.
 *
 * A leg is good value when it has a real decimal price and a strictly positive
 * edge (model probability minus the price's implied probability).
 *
 * Rule, which maximises the product of model probabilities:
 * 1. Keep at most one leg per game. Inside a game, keep the positive-edge leg
 *    with the highest model probability. Ties go to the higher edge, then the
 *    higher decimal price.
 * 2. Among those one-per-game legs, take the three with the highest model
 *    probabilities. With positive probabilities and one leg per game, that is
 *    the combination with the largest product.
 * 3. Fewer than three qualifying games means there is no parlay. Legs without
 *    a real price are ignored, whatever their model probability.
 *
 * Combined model probability is the product of the three (games treated as
 * independent). Combined decimal odds are the product of the three prices.
 */
export type SelectableLeg = {
  id: string;
  gameId: number;
  modelProb: number;
  decimalOdds: number | null;
  edge: number | null;
};

export const PARLAY_RULE =
  "Three legs, three games. Each leg needs a posted price and a positive edge (model % minus implied %). One leg per game: the highest model probability among positive-edge prices, tie-broken by edge then price. The three games with the highest of those probabilities maximise the product. Games are treated as independent.";

export function selectParlay(legs: SelectableLeg[]): {
  legIds: string[] | null;
  note: string;
} {
  const priced = legs.filter(
    (leg) =>
      leg.decimalOdds != null &&
      leg.decimalOdds > 1 &&
      leg.edge != null &&
      leg.edge > 0 &&
      Number.isFinite(leg.modelProb),
  );

  const byGame = new Map<number, SelectableLeg>();
  for (const leg of priced) {
    const current = byGame.get(leg.gameId);
    if (!current || beats(leg, current)) byGame.set(leg.gameId, leg);
  }

  const representatives = [...byGame.values()].sort(byProbability);
  if (representatives.length < 3) {
    const games = representatives.length;
    return {
      legIds: null,
      note: `No 3-leg parlay. ${games} ${games === 1 ? "game" : "games"} had a positive-edge price, and the card needs 3 different games.`,
    };
  }

  return {
    legIds: representatives.slice(0, 3).map((leg) => leg.id),
    note: PARLAY_RULE,
  };
}

export function combinedModelProbability(probabilities: number[]): number {
  return probabilities.reduce((product, probability) => product * probability, 1);
}

export function combinedDecimalOdds(odds: number[]): number {
  return odds.reduce((product, price) => product * price, 1);
}

function beats(candidate: SelectableLeg, incumbent: SelectableLeg): boolean {
  if (candidate.modelProb !== incumbent.modelProb) {
    return candidate.modelProb > incumbent.modelProb;
  }
  const edgeDelta = (candidate.edge ?? 0) - (incumbent.edge ?? 0);
  if (edgeDelta !== 0) return edgeDelta > 0;
  return (candidate.decimalOdds ?? 0) > (incumbent.decimalOdds ?? 0);
}

function byProbability(a: SelectableLeg, b: SelectableLeg): number {
  if (b.modelProb !== a.modelProb) return b.modelProb - a.modelProb;
  return (b.edge ?? 0) - (a.edge ?? 0);
}
