import type { MarketId } from "@/lib/model/constants";

export type PriceQuote = {
  gameId: number;
  playerName: string;
  market: MarketId;
  decimalOdds: number;
  source: string;
};

export type ProviderResult = {
  id: string;
  ok: boolean;
  skipped?: boolean;
  error?: string;
  httpStatus?: number;
  quotes: PriceQuote[];
};

export type OddsGame = {
  id: number;
  startTimeUtc: string;
  awayCommon: string;
  homeCommon: string;
  awayPlace: string;
  homeCommonName?: string;
  homePlaceName?: string;
  rosterNames: string[];
};
