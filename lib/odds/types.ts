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
  /** Latest x-requests-remaining seen on this run, including a cached header. */
  requestsRemaining?: number;
  /** Credits spent on this run. Cache hits add nothing. */
  creditsUsed?: number;
  /** True when every priced event was served from http_cache. */
  fromCache?: boolean;
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
