/**
 * Weights for the goal / point / shot model.
 * The About page restates these in prose. Change them here, not in the formula code.
 */
export const MODEL = {
  /** How many of the player's most recent games form the "recent" window. */
  recentGames: 10,
  /**
   * Recency decay. The most recent game has weight 1, the one before it decay^1,
   * and so on. 0.85 means a game ten back still carries about 20% of the latest game.
   */
  recentDecay: 0.85,
  /**
   * Share of the blended per-60 rate taken from the recent window once that window
   * has enough ice time. The rest is the season rate.
   */
  recentWeight: 0.65,
  /**
   * Recent ice time, in minutes, at which `recentWeight` applies in full.
   * Below this the recent share shrinks in proportion, down to zero.
   */
  fullRecentMinutes: 80,
  /** Share of projected ice time taken from the recent per-game average. */
  toiRecentWeight: 0.7,
  /** Games in the recent ice-time average. */
  toiRecentGames: 5,
  /**
   * When MoneyPuck expected goals are available, the season goal rate is this
   * share actual goals and the rest expected goals.
   */
  actualGoalShare: 0.5,
  minGames: 5,
  minAvgToiMinutes: 8,
  skatersPerTeam: 10,
  oppFactorMin: 0.82,
  oppFactorMax: 1.18,
  goalieFactorMin: 0.8,
  goalieFactorMax: 1.2,
  /**
   * How much of the goalie factor reaches assists.
   * 0 ignores the goalie; 1 treats assists like goals.
   */
  assistGoalieDamp: 0.35,
  /** Minutes that count as a start when deciding a back-to-back. */
  backToBackMinutes: 45,
  backupMinGames: 3,
} as const;

export const MARKETS = [
  "anytime_goal",
  "anytime_point",
  "sog_over_15",
  "sog_over_25",
] as const;

export type MarketId = (typeof MARKETS)[number];

export const MARKET_LABEL: Record<MarketId, string> = {
  anytime_goal: "Anytime goal",
  anytime_point: "Anytime point",
  sog_over_15: "Over 1.5 shots",
  sog_over_25: "Over 2.5 shots",
};

export const MARKET_TARGET: Record<MarketId, number> = {
  anytime_goal: 1,
  anytime_point: 1,
  sog_over_15: 2,
  sog_over_25: 3,
};
