import { describe, expect, it } from "vitest";
import type { Leg, Slate } from "@/lib/types";
import { gameStillToPrice, repriceOpenLegs, restorePrices, syncParlay } from "@/lib/slate/prices";

function leg(partial: Partial<Leg> & Pick<Leg, "id" | "gameId" | "playerId" | "playerName" | "market">): Leg {
  return {
    slateDate: "2026-11-12",
    teamAbbrev: "TBL",
    opponentAbbrev: "VAN",
    matchup: "TBL vs VAN",
    modelProb: 0.4,
    lambda: 0.5,
    target: 1,
    explanation: "",
    decimalOdds: null,
    impliedProb: null,
    edge: null,
    priceSource: null,
    headshot: "",
    teamLogo: "",
    status: "pending",
    current: 0,
    gameState: "FUT",
    clockLabel: "",
    startTimeUtc: "2026-11-13T00:00:00Z",
    ...partial,
  };
}

describe("games still to price", () => {
  const now = Date.parse("2026-11-12T12:00:00Z");

  it("keeps future games and skips live, final, and past puck drops", () => {
    expect(gameStillToPrice({ gameState: "FUT", startTimeUtc: "2026-11-12T23:00:00Z" }, now)).toBe(true);
    expect(gameStillToPrice({ gameState: "PRE", startTimeUtc: "2026-11-12T23:00:00Z" }, now)).toBe(true);
    expect(gameStillToPrice({ gameState: "LIVE", startTimeUtc: "2026-11-12T23:00:00Z" }, now)).toBe(false);
    expect(gameStillToPrice({ gameState: "OFF", startTimeUtc: "2026-11-12T23:00:00Z" }, now)).toBe(false);
    expect(gameStillToPrice({ gameState: "FUT", startTimeUtc: "2026-11-12T11:00:00Z" }, now)).toBe(false);
  });
});

describe("repricing open games", () => {
  it("keeps a started price, clears an unpriced open leg, and maps initials to the player id", () => {
    const started = leg({
      id: "started",
      gameId: 1,
      playerId: 86,
      playerName: "Nikita Kucherov",
      market: "anytime_goal",
      decimalOdds: 2.1,
      impliedProb: 0.47619,
      edge: -0.07619,
      priceSource: "pointsbet",
    });
    const openGoal = leg({
      id: "open-goal",
      gameId: 2,
      playerId: 86,
      playerName: "Nikita Kucherov",
      market: "anytime_goal",
      decimalOdds: 2.4,
      priceSource: "pointsbet",
    });
    const openShots = leg({
      id: "open-shots",
      gameId: 2,
      playerId: 18,
      playerName: "Tim Stutzle",
      market: "sog_over_25",
      decimalOdds: 1.8,
      priceSource: "pointsbet",
    });
    const ambiguous = leg({
      id: "ambiguous",
      gameId: 2,
      playerId: 99,
      playerName: "Nikolai Kucherov",
      teamAbbrev: "TBL",
      market: "anytime_goal",
      decimalOdds: 4,
      priceSource: "pointsbet",
    });
    const legs = [started, openGoal, openShots, ambiguous];
    repriceOpenLegs(
      legs,
      new Set([2]),
      [
        {
          id: "oddsapi",
          ok: true,
          quotes: [
            { gameId: 1, playerName: "Nikita Kucherov", market: "anytime_goal", decimalOdds: 9, source: "oddsapi:draftkings" },
            { gameId: 2, playerName: "Kucherov", market: "anytime_goal", decimalOdds: 3, source: "oddsapi:draftkings" },
            { gameId: 2, playerName: "Tim Stützle", market: "sog_over_25", decimalOdds: 2.25, source: "oddsapi:fanduel" },
          ],
        },
      ],
      new Map(),
    );

    expect(started.decimalOdds).toBe(2.1);
    expect(started.priceSource).toBe("pointsbet");
    expect(openGoal.decimalOdds).toBeNull();
    expect(openGoal.priceSource).toBeNull();
    expect(ambiguous.decimalOdds).toBeNull();
    expect(openShots.decimalOdds).toBe(2.25);
    expect(openShots.priceSource).toBe("oddsapi:fanduel");
    expect(openShots.edge).toBeCloseTo(0.4 - 1 / 2.25, 5);
  });

  it("keeps a stored price when that provider fails and nobody else posts one", () => {
    const shots = leg({
      id: "shots",
      gameId: 2,
      playerId: 18,
      playerName: "Tim Stutzle",
      market: "sog_over_15",
      decimalOdds: 1.91,
      impliedProb: 0.52356,
      edge: 0.02,
      priceSource: "oddsapi:draftkings",
    });
    repriceOpenLegs(
      [shots],
      new Set([2]),
      [
        { id: "pointsbet", ok: true, quotes: [] },
        { id: "oddsapi", ok: false, error: "The Odds API HTTP 401", quotes: [] },
      ],
      new Map(),
    );
    expect(shots.decimalOdds).toBe(1.91);
    expect(shots.priceSource).toBe("oddsapi:draftkings");
  });
});

describe("stored prices", () => {
  it("restores a saved price for a started game and recomputes the edge", () => {
    const fresh = leg({
      id: "leg",
      gameId: 5,
      playerId: 1,
      playerName: "Sebastian Aho",
      market: "anytime_point",
      modelProb: 0.62,
    });
    const saved = leg({
      id: "leg",
      gameId: 5,
      playerId: 1,
      playerName: "Sebastian Aho",
      market: "anytime_point",
      decimalOdds: 2.5,
      priceSource: "oddsapi:betmgm",
    });
    restorePrices([fresh], [saved], new Set([5]));
    expect(fresh.decimalOdds).toBe(2.5);
    expect(fresh.priceSource).toBe("oddsapi:betmgm");
    expect(fresh.edge).toBeCloseTo(0.62 - 0.4, 5);
    const other = leg({ id: "other", gameId: 6, playerId: 1, playerName: "Sebastian Aho", market: "anytime_point" });
    restorePrices([other], [saved], new Set([5]));
    expect(other.decimalOdds).toBeNull();
  });
});

describe("parlay after a price refresh", () => {
  it("keeps a parlay that already includes a started game and updates the combined price", () => {
    const started = leg({
      id: "a",
      gameId: 1,
      playerId: 1,
      playerName: "A",
      market: "anytime_goal",
      modelProb: 0.5,
      decimalOdds: 2,
      edge: 0.1,
    });
    const open = leg({
      id: "b",
      gameId: 2,
      playerId: 2,
      playerName: "B",
      market: "anytime_goal",
      modelProb: 0.5,
      decimalOdds: 3,
      edge: 0.1,
    });
    const third = leg({
      id: "c",
      gameId: 3,
      playerId: 3,
      playerName: "C",
      market: "anytime_goal",
      modelProb: 0.5,
      decimalOdds: 2,
      edge: 0.1,
    });
    const board = blankSlate([started, open, third], {
      legIds: ["a", "b", "c"],
      decimalOdds: 8,
      modelProb: 0.125,
      impliedProb: 0.125,
      edge: 0,
      status: "ALIVE",
      hitCount: 0,
    });
    syncParlay(board, new Set([2, 3]));
    expect(board.parlay?.legIds).toEqual(["a", "b", "c"]);
    expect(board.parlay?.decimalOdds).toBe(12);
    expect(board.parlay?.status).toBe("ALIVE");
  });
});

function blankSlate(legs: Leg[], parlay: Slate["parlay"]): Slate {
  return {
    slateDate: "2026-11-12",
    season: 20262027,
    builtAt: "2026-11-12T00:00:00Z",
    gradedAt: null,
    melbourneLabel: "",
    firstPuck: "",
    games: [],
    legs,
    parlay,
    parlayNote: "",
    modelNote: "",
    oddsReport: [],
  };
}
