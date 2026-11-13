import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTrackedMulti, canRemoveTrackedMulti, gradeTrackedMulti, trackedRecord } from "@/lib/multis/track";
import { removeTrackedMulti, saveBuiltMulti, syncTrackedGrades } from "@/lib/multis/persist";
import { resetStoreForTests } from "@/lib/storage";
import { formatMelbourneStamp } from "@/lib/time";
import type { Leg, Slate } from "@/lib/types";

let directory = "";
const previousDatabase = process.env.DATABASE_URL;

beforeEach(async () => {
  delete process.env.DATABASE_URL;
  directory = await mkdtemp(path.join(tmpdir(), "nhl-multis-"));
  process.env.DATA_DIR = directory;
  resetStoreForTests();
});

afterEach(async () => {
  if (previousDatabase == null) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabase;
  delete process.env.DATA_DIR;
  resetStoreForTests();
  if (directory) await rm(directory, { recursive: true, force: true });
});

describe("tracked multis", () => {
  const savedAt = new Date("2026-11-13T04:06:00.000Z");

  it("saves the built multi and grades it from the slate without moving the price", async () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const board = slate([
      leg({ id: "a", gameId: 1, playerName: "Auston Matthews", modelProb: 0.5, decimalOdds: 2, edge: 0.08, startTimeUtc: future }),
      leg({ id: "b", gameId: 2, playerName: "Connor McDavid", modelProb: 0.4, decimalOdds: 2.5, edge: 0.04, startTimeUtc: future }),
      leg({ id: "c", gameId: 3, playerName: "Leon Draisaitl", modelProb: 0.3, decimalOdds: 3, edge: 0.02, startTimeUtc: future }),
    ]);

    const saved = await saveBuiltMulti(board, 2, savedAt);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.existing).toBe(false);
    expect(saved.multi.size).toBe(2);
    expect(saved.multi.slateDate).toBe(board.slateDate);
    expect(saved.multi.savedAt).toBe(savedAt.toISOString());
    expect(saved.multi.savedLabel).toBe(formatMelbourneStamp(savedAt.toISOString()));
    expect(saved.multi.legs.map((item) => item.playerName)).toEqual(["Auston Matthews", "Connor McDavid"]);
    expect(saved.multi.decimalOdds).toBeCloseTo(5, 4);
    expect(saved.multi.modelProb).toBeCloseTo(0.2, 6);
    expect(saved.multi.status).toBe("ALIVE");

    const again = await saveBuiltMulti(board, 2, savedAt);
    expect(again.ok && again.existing && again.multi.id).toBe(saved.multi.id);

    const live = structuredClone(board);
    const first = live.legs.find((item) => item.id === "a");
    const second = live.legs.find((item) => item.id === "b");
    if (!first || !second) throw new Error("missing legs");
    first.status = "dead";
    first.current = 0;
    first.gameState = "OFF";
    second.status = "hit";
    second.current = 1;
    second.gameState = "LIVE";
    live.legs.find((item) => item.id === "a")!.decimalOdds = 9;

    const graded = await syncTrackedGrades([live]);
    expect(graded).toHaveLength(1);
    expect(graded[0].status).toBe("LOST");
    expect(graded[0].hitCount).toBe(1);
    expect(graded[0].decimalOdds).toBe(saved.multi.decimalOdds);
    expect(graded[0].modelProb).toBe(saved.multi.modelProb);
    expect(graded[0].legs[0].decimalOdds).toBe(2);
    expect(graded[0].legs.map((item) => item.status)).toEqual(["dead", "hit"]);

    const refused = await removeTrackedMulti(saved.multi.id);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.note).toMatch(/started/);
  });

  it("removes a multi only before its games start, and refuses a short board", async () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const open = slate([
      leg({ id: "a", gameId: 1, startTimeUtc: future, gameState: "FUT" }),
      leg({ id: "b", gameId: 2, startTimeUtc: future, gameState: "FUT" }),
    ]);
    const saved = await saveBuiltMulti(open, 2, savedAt);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(canRemoveTrackedMulti(saved.multi)).toBe(true);
    expect(await removeTrackedMulti(saved.multi.id)).toEqual({ ok: true });
    expect(await removeTrackedMulti(saved.multi.id)).toMatchObject({ ok: false, missing: true });

    const started = slate([
      leg({ id: "a", gameId: 1, startTimeUtc: future, gameState: "LIVE" }),
      leg({ id: "b", gameId: 2, startTimeUtc: past, gameState: "FUT" }),
    ]);
    const locked = buildTrackedMulti(started, 2, savedAt);
    expect(locked.ok).toBe(true);
    if (!locked.ok) return;
    expect(canRemoveTrackedMulti(locked.multi)).toBe(false);

    const short = await saveBuiltMulti(slate([leg({ id: "only", gameId: 1, startTimeUtc: future })]), 4, savedAt);
    expect(short.ok).toBe(false);
    if (!short.ok) expect(short.note).toMatch(/No 4-leg multi/);
  });

  it("grades a won multi and a void multi from leg results", () => {
    const board = slate([
      leg({ id: "a", gameId: 1, status: "hit", current: 1 }),
      leg({ id: "b", gameId: 2, status: "hit", current: 1 }),
    ]);
    const built = buildTrackedMulti(board, 2, savedAt);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.multi.status).toBe("WON");

    const voided = structuredClone(board);
    voided.legs[1].status = "void";
    expect(gradeTrackedMulti(built.multi, voided).status).toBe("VOID");
  });

  it("counts the tracked record by size", () => {
    const record = trackedRecord([
      { size: 2, status: "WON" },
      { size: 2, status: "LOST" },
      { size: 4, status: "ALIVE" },
      { size: 6, status: "VOID" },
    ]);
    expect(record.won).toBe(1);
    expect(record.lost).toBe(1);
    expect(record.voided).toBe(1);
    expect(record.open).toBe(1);
    expect(record.bySize.map((row) => [row.size, row.won, row.lost, row.open, row.voided])).toEqual([
      [2, 1, 1, 0, 0],
      [4, 0, 0, 1, 0],
      [6, 0, 0, 0, 1],
    ]);
  });
});

function slate(legs: Leg[]): Slate {
  return {
    slateDate: "2026-11-13",
    season: 20262027,
    builtAt: "2026-11-13T00:00:00.000Z",
    gradedAt: null,
    melbourneLabel: "Friday, 13 November",
    firstPuck: "Fri, 7:00 pm",
    games: [],
    legs,
    parlay: null,
    parlayNote: "",
    modelNote: "",
    oddsReport: [],
  };
}

function leg(partial: Partial<Leg> & Pick<Leg, "id" | "gameId">): Leg {
  return {
    slateDate: "2026-11-13",
    playerId: partial.gameId,
    playerName: partial.playerName ?? partial.id,
    teamAbbrev: "TOR",
    opponentAbbrev: "BOS",
    matchup: "TOR @ BOS",
    market: "anytime_goal",
    modelProb: 0.4,
    lambda: 0.4,
    target: 1,
    explanation: "",
    decimalOdds: 2,
    impliedProb: 0.5,
    edge: 0.05,
    priceSource: "sportsbet",
    headshot: "",
    teamLogo: "",
    status: "pending",
    current: 0,
    gameState: "FUT",
    clockLabel: "Fri, 7:00 pm",
    startTimeUtc: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    ...partial,
  };
}
