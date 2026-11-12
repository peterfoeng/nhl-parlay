import { describe, expect, it } from "vitest";
import { summarizeHistory, parlayProfit } from "@/lib/history/summary";
import { pickStarter, type StarterCandidate } from "@/lib/slate/starter";
import { parseCsv } from "@/lib/moneypuck/csv";
import { chooseOpenSlateDate, gameClockLabel, previousDate } from "@/lib/time";

describe("starter", () => {
  const goalies: StarterCandidate[] = [
    {
      playerId: 1,
      name: "Recent",
      games: 12,
      lastDate: "2026-11-11",
      lastToiMinutes: 60,
      goalsAgainst: 20,
      xGoalsAgainst: 25,
    },
    {
      playerId: 2,
      name: "Backup",
      games: 8,
      lastDate: "2026-11-08",
      lastToiMinutes: 60,
      goalsAgainst: 15,
      xGoalsAgainst: 15,
    },
  ];

  it("picks the most recent goalie, or the other one on a back-to-back", () => {
    const normal = pickStarter(goalies, false, "2026-11-11");
    expect(normal.playerId).toBe(1);
    expect(normal.factor).toBeCloseTo(0.8, 8);

    const backToBack = pickStarter(goalies, true, "2026-11-11");
    expect(backToBack.playerId).toBe(2);
    expect(backToBack.reason).toContain("Back-to-back");
  });
});

describe("dates and clocks", () => {
  it("steps NHL slate dates in UTC and labels Melbourne time", () => {
    expect(previousDate("2026-11-12")).toBe("2026-11-11");
    expect(previousDate("2026-03-01")).toBe("2026-02-28");
    expect(
      chooseOpenSlateDate([
        { slateDate: "2026-11-10", gameState: "OFF", startTimeUtc: "2026-11-11T00:00:00Z" },
        { slateDate: "2026-11-11", gameState: "LIVE", startTimeUtc: "2026-11-12T00:00:00Z" },
        { slateDate: "2026-11-12", gameState: "FUT", startTimeUtc: "2026-11-12T17:00:00Z" },
      ]),
    ).toBe("2026-11-11");
    expect(
      gameClockLabel({
        gameState: "LIVE",
        startTimeUtc: "2026-11-12T00:00:00Z",
        period: { number: 3, periodType: "REG" },
        clock: { timeRemaining: "15:18", inIntermission: false },
      }),
    ).toBe("3rd 15:18");
    expect(
      gameClockLabel({
        gameState: "FUT",
        startTimeUtc: "2026-11-12T17:00:00Z",
      }),
    ).toContain("4:00");
    expect(gameClockLabel({ gameState: "OFF", startTimeUtc: "2026-11-12T00:00:00Z" })).toBe("Final");
  });
});

describe("history", () => {
  it("settles a unit and compares model rate with hits", () => {
    expect(parlayProfit("WON", 6.5)).toBeCloseTo(5.5, 8);
    expect(parlayProfit("LOST", 6.5)).toBe(-1);
    expect(parlayProfit("ALIVE", 6.5)).toBeNull();

    const summary = summarizeHistory({
      parlays: [
        { slateDate: "2026-11-01", status: "WON", decimalOdds: 6, modelProb: 0.2, hitCount: 3, legCount: 3 },
        { slateDate: "2026-11-02", status: "LOST", decimalOdds: 5, modelProb: 0.2, hitCount: 1, legCount: 3 },
        { slateDate: "2026-11-03", status: "ALIVE", decimalOdds: 4, modelProb: 0.2, hitCount: 0, legCount: 3 },
      ],
      legs: [
        { market: "anytime_goal", modelProb: 0.4, status: "hit" },
        { market: "anytime_goal", modelProb: 0.2, status: "dead" },
        { market: "anytime_goal", modelProb: 0.9, status: "pending" },
        { market: "anytime_goal", modelProb: 0.3, status: "void" },
      ],
    });
    expect(summary.won).toBe(1);
    expect(summary.lost).toBe(1);
    expect(summary.profitUnits).toBeCloseTo(4, 8);
    const goals = summary.markets.find((market) => market.market === "anytime_goal");
    expect(goals?.sample).toBe(2);
    expect(goals?.hitRate).toBeCloseTo(0.5, 8);
    expect(goals?.averageModel).toBeCloseTo(0.3, 8);
    expect(goals?.gap).toBeCloseTo(-0.2, 8);
  });
});

describe("csv", () => {
  it("keeps quoted commas and the first of a duplicated header", () => {
    const rows = parseCsv('team,name,team\nBUF,"Thompson, Tage",BUF\n');
    expect(rows).toEqual([{ team: "BUF", name: "Thompson, Tage", team_2: "BUF" }]);
  });
});
