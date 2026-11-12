import { MODEL } from "@/lib/model/constants";

export type Counting = {
  goals: number;
  assists: number;
  shots: number;
  toiSeconds: number;
  xGoals?: number | null;
};

export type LogGame = {
  gameDate: string;
  goals: number;
  assists: number;
  shots: number;
  toiSeconds: number;
};

export function per60(count: number, toiSeconds: number): number | null {
  if (!(toiSeconds > 0) || !Number.isFinite(count)) return null;
  return count / (toiSeconds / 3600);
}

export function aggregate(games: LogGame[]): Counting {
  return games.reduce<Counting>(
    (total, game) => ({
      goals: total.goals + game.goals,
      assists: total.assists + game.assists,
      shots: total.shots + game.shots,
      toiSeconds: total.toiSeconds + game.toiSeconds,
    }),
    { goals: 0, assists: 0, shots: 0, toiSeconds: 0 },
  );
}

/** `games` is most-recent first. Counts and ice time share the same decay weights. */
export function weightedRecent(
  games: LogGame[],
  decay: number = MODEL.recentDecay,
  window: number = MODEL.recentGames,
): Counting {
  const slice = games.slice(0, window);
  const total: Counting = { goals: 0, assists: 0, shots: 0, toiSeconds: 0 };
  slice.forEach((game, index) => {
    const weight = decay ** index;
    total.goals += game.goals * weight;
    total.assists += game.assists * weight;
    total.shots += game.shots * weight;
    total.toiSeconds += game.toiSeconds * weight;
  });
  return total;
}

/** Recent share after shrinking for a short recent sample. */
export function recentShare(
  recentToiMinutes: number,
  recentWeight = MODEL.recentWeight,
  fullRecentMinutes = MODEL.fullRecentMinutes,
): number {
  if (!(fullRecentMinutes > 0)) return recentWeight;
  const scale = Math.max(0, Math.min(1, recentToiMinutes / fullRecentMinutes));
  return recentWeight * scale;
}

export function blendRate(
  recent: number | null,
  season: number | null,
  recentToiMinutes: number,
  recentWeight = MODEL.recentWeight,
  fullRecentMinutes = MODEL.fullRecentMinutes,
): number | null {
  if (recent == null && season == null) return null;
  if (recent == null) return season;
  if (season == null) return recent;
  const weight = recentShare(recentToiMinutes, recentWeight, fullRecentMinutes);
  return weight * recent + (1 - weight) * season;
}

/**
 * Season goal rate. With MoneyPuck xG, blend actual goals and expected goals.
 * Without xG, use actual goals only.
 */
export function goalRatePer60(
  goals: number,
  xGoals: number | null | undefined,
  toiSeconds: number,
  actualShare = MODEL.actualGoalShare,
): number | null {
  const actual = per60(goals, toiSeconds);
  const expected = xGoals == null ? null : per60(xGoals, toiSeconds);
  if (actual == null) return expected;
  if (expected == null) return actual;
  return actualShare * actual + (1 - actualShare) * expected;
}

export function averageToiMinutes(games: LogGame[], count: number): number | null {
  const slice = games.slice(0, count).filter((game) => game.toiSeconds > 0);
  if (!slice.length) return null;
  const seconds = slice.reduce((sum, game) => sum + game.toiSeconds, 0) / slice.length;
  return seconds / 60;
}
