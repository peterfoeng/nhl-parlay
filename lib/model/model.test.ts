import { describe, expect, it } from "vitest";
import { expectedCounts, goalieQualityFactor, opponentShotFactor } from "@/lib/model/adjust";
import { poissonAtLeast } from "@/lib/model/poisson";
import { projectPlayer } from "@/lib/model/player";
import { projectToiMinutes } from "@/lib/model/project";
import { blendRate, per60, weightedRecent, type LogGame } from "@/lib/model/rates";

describe("poisson", () => {
  it("converts expected counts into at-least probabilities", () => {
    expect(poissonAtLeast(1, 0)).toBe(0);
    expect(poissonAtLeast(1, 1)).toBeCloseTo(1 - Math.exp(-1), 8);
    expect(poissonAtLeast(2, 1)).toBeCloseTo(1 - Math.exp(-1) * 2, 8);
    expect(poissonAtLeast(3, 1)).toBeCloseTo(1 - Math.exp(-1) * 2.5, 8);
    expect(poissonAtLeast(1, -1)).toBeNaN();
  });
});

describe("rate blending", () => {
  it("weights recent games by decay and ice time", () => {
    const games: LogGame[] = [
      { gameDate: "2026-11-10", goals: 2, assists: 0, shots: 0, toiSeconds: 3600 },
      { gameDate: "2026-11-08", goals: 0, assists: 0, shots: 0, toiSeconds: 3600 },
    ];
    const recent = weightedRecent(games, 0.5, 10);
    expect(per60(recent.goals, recent.toiSeconds)).toBeCloseTo(2 / 1.5, 8);
  });

  it("shrinks the recent share when the window is short", () => {
    expect(blendRate(2, 1, 80, 0.65, 80)).toBeCloseTo(1.65, 8);
    expect(blendRate(2, 1, 40, 0.65, 80)).toBeCloseTo(1.325, 8);
    expect(blendRate(null, 1.4, 0)).toBe(1.4);
    expect(blendRate(2, null, 10)).toBe(2);
  });
});

describe("adjustments", () => {
  it("clamps opponent shot volume and goalie quality", () => {
    expect(opponentShotFactor(40, 30)).toBeCloseTo(1.18, 8);
    expect(opponentShotFactor(20, 30)).toBeCloseTo(0.82, 8);
    expect(opponentShotFactor(null, 30)).toBe(1);
    expect(goalieQualityFactor(20, 25)).toBeCloseTo(0.8, 8);
    expect(goalieQualityFactor(30, 25)).toBeCloseTo(1.2, 8);
    expect(goalieQualityFactor(22, 25)).toBeCloseTo(0.88, 8);
    expect(goalieQualityFactor(10, 0)).toBeNull();
  });

  it("applies the goalie factor fully to goals and partly to assists", () => {
    const expected = expectedCounts({
      goalsPer60: 1,
      assistsPer60: 1,
      shotsPer60: 3,
      toiMinutes: 60,
      oppFactor: 1.1,
      goalieFactor: 0.9,
      assistGoalieDamp: 0.35,
    });
    expect(expected.goals).toBeCloseTo(0.99, 8);
    expect(expected.assists).toBeCloseTo(1.1 * (1 + 0.35 * (0.9 - 1)), 8);
    expect(expected.shots).toBeCloseTo(3.3, 8);
    expect(expected.points).toBeCloseTo(expected.goals + expected.assists, 8);
  });

  it("blends projected ice time toward the season average", () => {
    expect(projectToiMinutes(20, 10, 0.7)).toBeCloseTo(17, 8);
    expect(projectToiMinutes(null, 16, 0.7)).toBe(16);
  });
});

describe("projectPlayer", () => {
  it("turns a one-hour rate into a Poisson probability", () => {
    const game: LogGame = {
      gameDate: "2026-11-10",
      goals: 1,
      assists: 1,
      shots: 3,
      toiSeconds: 3600,
    };
    const markets = projectPlayer({
      priorGames: [game],
      season: { goals: 1, assists: 1, shots: 3, toiSeconds: 3600 },
      seasonGames: 1,
      useMoneyPuckSeason: false,
      oppFactor: 1,
      goalieFactor: 1,
      goalieReason: "Neutral goalie.",
    });
    expect(markets).not.toBeNull();
    const byId = Object.fromEntries((markets ?? []).map((market) => [market.market, market]));
    expect(byId.anytime_goal.lambda).toBeCloseTo(1, 6);
    expect(byId.anytime_goal.probability).toBeCloseTo(1 - Math.exp(-1), 6);
    expect(byId.anytime_point.lambda).toBeCloseTo(2, 6);
    expect(byId.sog_over_15.target).toBe(2);
    expect(byId.sog_over_25.target).toBe(3);
    expect(byId.sog_over_15.lambda).toBeCloseTo(3, 6);
    expect(byId.anytime_goal.explanation).toContain("Poisson");
  });

  it("moves expected goals when the opponent and goalie change", () => {
    const game: LogGame = {
      gameDate: "2026-11-10",
      goals: 1,
      assists: 0,
      shots: 0,
      toiSeconds: 3600,
    };
    const markets = projectPlayer({
      priorGames: [game],
      season: gameToCount(game),
      seasonGames: 1,
      useMoneyPuckSeason: false,
      oppFactor: 1.1,
      goalieFactor: 0.9,
      goalieReason: "Likely starter Test Goalie.",
    });
    const goals = markets?.find((market) => market.market === "anytime_goal");
    expect(goals?.lambda).toBeCloseTo(0.99, 6);
    expect(goals?.explanation).toContain("Test Goalie");
  });
});

function gameToCount(game: LogGame) {
  return {
    goals: game.goals,
    assists: game.assists,
    shots: game.shots,
    toiSeconds: game.toiSeconds,
  };
}
