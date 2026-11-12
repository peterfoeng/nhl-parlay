import { MODEL } from "@/lib/model/constants";

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function shotsAgainstPer60(shotsAgainst: number, iceTimeSeconds: number): number | null {
  if (!(iceTimeSeconds > 0) || !Number.isFinite(shotsAgainst)) return null;
  return shotsAgainst / (iceTimeSeconds / 3600);
}

/** Opponent shots allowed per 60, divided by the league rate, clamped. */
export function opponentShotFactor(
  opponentSa60: number | null,
  leagueSa60: number | null,
  min = MODEL.oppFactorMin,
  max = MODEL.oppFactorMax,
): number {
  if (opponentSa60 == null || leagueSa60 == null || !(leagueSa60 > 0)) return 1;
  return clamp(opponentSa60 / leagueSa60, min, max);
}

/**
 * Goals allowed divided by expected goals allowed.
 * Below 1 is a better-than-expected goalie (fewer goals). Null when xG is missing.
 */
export function goalieQualityFactor(
  goalsAgainst: number | null,
  xGoalsAgainst: number | null,
  min = MODEL.goalieFactorMin,
  max = MODEL.goalieFactorMax,
): number | null {
  if (goalsAgainst == null || xGoalsAgainst == null || !(xGoalsAgainst > 0)) return null;
  if (!Number.isFinite(goalsAgainst)) return null;
  return clamp(goalsAgainst / xGoalsAgainst, min, max);
}

export type Expectations = {
  goals: number;
  assists: number;
  points: number;
  shots: number;
  oppFactor: number;
  goalieFactor: number;
  assistFactor: number;
};

export function expectedCounts(input: {
  goalsPer60: number;
  assistsPer60: number;
  shotsPer60: number;
  toiMinutes: number;
  oppFactor: number;
  goalieFactor: number;
  assistGoalieDamp?: number;
}): Expectations {
  const hours = input.toiMinutes / 60;
  const goalie = input.goalieFactor;
  const damp = input.assistGoalieDamp ?? MODEL.assistGoalieDamp;
  const assistFactor = 1 + damp * (goalie - 1);
  const goals = Math.max(0, input.goalsPer60 * hours * input.oppFactor * goalie);
  const assists = Math.max(0, input.assistsPer60 * hours * input.oppFactor * assistFactor);
  const shots = Math.max(0, input.shotsPer60 * hours * input.oppFactor);
  return {
    goals,
    assists,
    points: goals + assists,
    shots,
    oppFactor: input.oppFactor,
    goalieFactor: goalie,
    assistFactor,
  };
}
