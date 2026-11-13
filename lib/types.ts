import type { MarketId } from "@/lib/model/constants";
import type { LegStatus, ParlayStatus } from "@/lib/grading/grade";

export type SlateGame = {
  id: number;
  startTimeUtc: string;
  gameState: string;
  awayAbbrev: string;
  homeAbbrev: string;
  awayCommon: string;
  homeCommon: string;
  awayPlace: string;
  homePlace: string;
  awayLogo: string;
  homeLogo: string;
  clockLabel: string;
  periodNumber?: number;
  periodType?: string;
};

export type Leg = {
  id: string;
  slateDate: string;
  playerId: number;
  playerName: string;
  teamAbbrev: string;
  opponentAbbrev: string;
  gameId: number;
  matchup: string;
  market: MarketId;
  modelProb: number;
  lambda: number;
  target: number;
  explanation: string;
  decimalOdds: number | null;
  impliedProb: number | null;
  edge: number | null;
  priceSource: string | null;
  headshot: string;
  teamLogo: string;
  status: LegStatus;
  current: number;
  gameState: string;
  clockLabel: string;
  startTimeUtc: string;
};

export type TrackedLeg = {
  id: string;
  gameId: number;
  playerId: number;
  playerName: string;
  teamAbbrev: string;
  market: MarketId;
  matchup: string;
  modelProb: number;
  decimalOdds: number;
  edge: number;
  priceSource: string | null;
  book: string;
  headshot: string;
  teamLogo: string;
  target: number;
  startTimeUtc: string;
  status: LegStatus;
  current: number;
  clockLabel: string;
  gameState: string;
};

export type TrackedMulti = {
  id: string;
  slateDate: string;
  size: number;
  savedAt: string;
  savedLabel: string;
  legs: TrackedLeg[];
  decimalOdds: number;
  modelProb: number;
  impliedProb: number;
  edge: number;
  status: ParlayStatus;
  hitCount: number;
};

export type Parlay = {
  legIds: string[];
  decimalOdds: number;
  modelProb: number;
  impliedProb: number;
  edge: number;
  status: ParlayStatus;
  hitCount: number;
};

export type OddsProviderReport = {
  id: string;
  ok: boolean;
  skipped?: boolean;
  error?: string;
  httpStatus?: number;
  quotes: number;
  requestsRemaining?: number;
  creditsUsed?: number;
  fromCache?: boolean;
};

export type Slate = {
  slateDate: string;
  season: number;
  builtAt: string;
  gradedAt: string | null;
  melbourneLabel: string;
  firstPuck: string;
  games: SlateGame[];
  legs: Leg[];
  parlay: Parlay | null;
  parlayNote: string;
  modelNote: string;
  oddsReport: OddsProviderReport[];
};

export type ScheduledGame = {
  id: number;
  slateDate: string;
  season: number;
  startTimeUtc: string;
  gameState: string;
  away: TeamSide;
  home: TeamSide;
  period?: { number?: number; periodType?: string };
  clock?: { timeRemaining?: string; inIntermission?: boolean };
};

export type TeamSide = {
  abbrev: string;
  common: string;
  place: string;
  logo: string;
};
