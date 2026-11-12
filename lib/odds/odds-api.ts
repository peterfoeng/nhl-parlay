import type { MarketId } from "@/lib/model/constants";
import { toDecimalOdds } from "@/lib/odds/decimal";
import type { PriceQuote } from "@/lib/odds/types";

export type OddsApiOutcome = {
  name?: string;
  description?: string;
  price?: number;
  point?: number;
};

export type OddsApiMarket = {
  key?: string;
  outcomes?: OddsApiOutcome[];
};

export type OddsApiBookmaker = {
  key?: string;
  markets?: OddsApiMarket[];
};

const MARKET_KEYS: Record<string, MarketId | "shots" | "points"> = {
  player_goal_scorer_anytime: "anytime_goal",
  player_points: "points",
  player_shots_on_goal: "shots",
};

/** The Odds API event-odds payload. Bookmaker key is kept on the source string. */
export function quotesFromOddsApi(
  gameId: number,
  bookmakers: OddsApiBookmaker[],
): PriceQuote[] {
  const quotes: PriceQuote[] = [];
  for (const book of bookmakers) {
    const bookKey = book.key || "book";
    for (const market of book.markets ?? []) {
      const kind = market.key ? MARKET_KEYS[market.key] : undefined;
      if (!kind) continue;
      for (const outcome of market.outcomes ?? []) {
        if (outcome.price == null) continue;
        const decimal = toDecimalOdds(outcome.price);
        if (decimal == null || !(decimal > 1)) continue;
        const side = (outcome.name ?? "").toLowerCase();
        if (side === "under" || side === "no") continue;
        const playerName = (outcome.description || (side === "over" || side === "yes" ? "" : outcome.name) || "").trim();
        if (!playerName) continue;

        let marketId: MarketId | null = null;
        if (kind === "anytime_goal") marketId = "anytime_goal";
        if (kind === "points") {
          const point = outcome.point;
          if (point == null || point === 0.5) marketId = "anytime_point";
        }
        if (kind === "shots") {
          if (outcome.point === 1.5) marketId = "sog_over_15";
          if (outcome.point === 2.5) marketId = "sog_over_25";
        }
        if (!marketId) continue;
        quotes.push({
          gameId,
          playerName,
          market: marketId,
          decimalOdds: decimal,
          source: `oddsapi:${bookKey}`,
        });
      }
    }
  }
  return quotes;
}
