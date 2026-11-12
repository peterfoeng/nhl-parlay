import { quotesFromSelections } from "@/lib/odds/classify";
import type { PriceQuote } from "@/lib/odds/types";

export type PointsBetOutcome = {
  name?: string;
  price?: number;
  points?: number;
  isOpenForBetting?: boolean;
  side?: string;
};

export type PointsBetMarket = {
  name?: string;
  eventName?: string;
  isOpenForBetting?: boolean;
  outcomes?: PointsBetOutcome[];
};

/** Pull supported player markets from one PointsBet event payload. */
export function quotesFromPointsbetEvent(gameId: number, event: { fixedOddsMarkets?: PointsBetMarket[] }): PriceQuote[] {
  const markets = event.fixedOddsMarkets ?? [];
  const quotes: PriceQuote[] = [];
  for (const market of markets) {
    if (market.isOpenForBetting === false) continue;
    const marketName = market.name || market.eventName || "";
    const shortName = marketName.split("(")[0].trim();
    quotes.push(
      ...quotesFromSelections({
        gameId,
        source: "pointsbet",
        marketName: shortName,
        selections: (market.outcomes ?? [])
          .filter((outcome) => outcome.isOpenForBetting !== false)
          .map((outcome) => ({
            name: outcome.name,
            price: outcome.price,
            line: outcome.points,
            side: outcome.side,
          })),
      }),
    );
  }
  return quotes;
}
