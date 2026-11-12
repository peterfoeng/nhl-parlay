import type { MarketId } from "@/lib/model/constants";
import { MARKET_LABEL, MARKETS } from "@/lib/model/constants";
import type { LegStatus, ParlayStatus } from "@/lib/grading/grade";

export type SummaryLeg = {
  market: MarketId;
  modelProb: number;
  status: LegStatus;
};

export type SummaryParlay = {
  slateDate: string;
  status: ParlayStatus;
  decimalOdds: number;
  modelProb: number;
  hitCount: number;
  legCount: number;
};

export type MarketCalibration = {
  market: MarketId;
  label: string;
  sample: number;
  hits: number;
  hitRate: number | null;
  averageModel: number | null;
  gap: number | null;
};

export type HistorySummary = {
  settled: number;
  won: number;
  lost: number;
  voided: number;
  profitUnits: number;
  parlays: SummaryParlay[];
  markets: MarketCalibration[];
};

/** Notional 1 unit on each settled parlay. Won pays decimal odds minus 1. Lost costs 1. Void is 0. */
export function parlayProfit(status: ParlayStatus, decimalOdds: number): number | null {
  if (status === "WON") return decimalOdds - 1;
  if (status === "LOST") return -1;
  if (status === "VOID") return 0;
  return null;
}

export function summarizeHistory(input: {
  parlays: SummaryParlay[];
  legs: SummaryLeg[];
}): HistorySummary {
  let won = 0;
  let lost = 0;
  let voided = 0;
  let profitUnits = 0;
  for (const parlay of input.parlays) {
    const profit = parlayProfit(parlay.status, parlay.decimalOdds);
    if (profit == null) continue;
    if (parlay.status === "WON") won += 1;
    if (parlay.status === "LOST") lost += 1;
    if (parlay.status === "VOID") voided += 1;
    profitUnits += profit;
  }

  const markets = MARKETS.map((market) => {
    const rows = input.legs.filter(
      (leg) => leg.market === market && (leg.status === "hit" || leg.status === "dead"),
    );
    const hits = rows.filter((leg) => leg.status === "hit").length;
    const sample = rows.length;
    const averageModel = sample
      ? rows.reduce((sum, leg) => sum + leg.modelProb, 0) / sample
      : null;
    const hitRate = sample ? hits / sample : null;
    return {
      market,
      label: MARKET_LABEL[market],
      sample,
      hits,
      hitRate,
      averageModel,
      gap: averageModel != null && hitRate != null ? averageModel - hitRate : null,
    };
  });

  return {
    settled: won + lost + voided,
    won,
    lost,
    voided,
    profitUnits,
    parlays: input.parlays,
    markets,
  };
}
