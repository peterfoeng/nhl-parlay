import type { MarketId } from "@/lib/model/constants";

export type LegStatus = "pending" | "hit" | "dead" | "void";
export type ParlayStatus = "ALIVE" | "WON" | "LOST" | "VOID";

export type BoxLine = {
  goals: number;
  assists: number;
  points: number;
  shots: number;
  toiSeconds: number;
};

const FINAL_STATES = new Set(["OFF", "FINAL", "OFFICIAL", "OVER"]);
const LIVE_STATES = new Set(["LIVE", "CRIT"]);

export function isFinalState(gameState: string): boolean {
  return FINAL_STATES.has(gameState);
}

export function isLiveState(gameState: string): boolean {
  return LIVE_STATES.has(gameState);
}

export function currentStat(market: MarketId, line: BoxLine | null): number {
  if (!line) return 0;
  if (market === "anytime_goal") return line.goals;
  if (market === "anytime_point") return line.points;
  return line.shots;
}

/**
 * Hit as soon as the count reaches the target, even if the game is still going.
 * A final game with the player absent or at zero ice time is void (did not play).
 * A final game short of the target is dead. Anything unfinished is pending.
 */
export function gradeLeg(input: {
  current: number;
  target: number;
  gameFinal: boolean;
  inBoxscore: boolean;
  toiSeconds: number;
}): LegStatus {
  if (input.current >= input.target) return "hit";
  if (!input.gameFinal) return "pending";
  if (!input.inBoxscore || input.toiSeconds <= 0) return "void";
  return "dead";
}

/** Lost if any leg is dead. Won only if every leg hit. Void if a leg did not play and nothing is dead or still pending. */
export function gradeParlay(statuses: LegStatus[]): ParlayStatus {
  if (statuses.length === 0) return "ALIVE";
  if (statuses.some((status) => status === "dead")) return "LOST";
  if (statuses.some((status) => status === "pending")) return "ALIVE";
  if (statuses.every((status) => status === "hit")) return "WON";
  return "VOID";
}

export function hitCount(statuses: LegStatus[]): number {
  return statuses.filter((status) => status === "hit").length;
}
