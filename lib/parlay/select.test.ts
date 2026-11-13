import { describe, expect, it } from "vitest";
import {
  combinedDecimalOdds,
  combinedModelProbability,
  PARLAY_RULE,
  selectMulti,
  selectParlay,
  type SelectableLeg,
} from "@/lib/parlay/select";

function leg(partial: Partial<SelectableLeg> & Pick<SelectableLeg, "id" | "gameId" | "modelProb">): SelectableLeg {
  return {
    decimalOdds: 2,
    edge: 0.05,
    ...partial,
  };
}

describe("selectParlay", () => {
  it("maximises combined model probability across three games", () => {
    const result = selectParlay([
      leg({ id: "a", gameId: 1, modelProb: 0.6, edge: 0.05 }),
      leg({ id: "b", gameId: 1, modelProb: 0.7, edge: -0.01, decimalOdds: 1.5 }),
      leg({ id: "c", gameId: 2, modelProb: 0.5, edge: 0.02 }),
      leg({ id: "d", gameId: 3, modelProb: 0.4, edge: 0.1 }),
      leg({ id: "e", gameId: 4, modelProb: 0.55, edge: 0.01 }),
      leg({ id: "f", gameId: 5, modelProb: 0.9, edge: null, decimalOdds: null }),
    ]);
    expect(result.legIds).toEqual(["a", "e", "c"]);
  });

  it("refuses a parlay when prices or games run out", () => {
    const oneGame = selectParlay([
      leg({ id: "a", gameId: 1, modelProb: 0.8 }),
      leg({ id: "b", gameId: 1, modelProb: 0.7 }),
    ]);
    expect(oneGame.legIds).toBeNull();

    const unpriced = selectParlay([
      leg({ id: "a", gameId: 1, modelProb: 0.9, decimalOdds: null, edge: null }),
      leg({ id: "b", gameId: 2, modelProb: 0.8, decimalOdds: null, edge: null }),
      leg({ id: "c", gameId: 3, modelProb: 0.7, decimalOdds: null, edge: null }),
    ]);
    expect(unpriced.legIds).toBeNull();
  });

  it("breaks ties inside a game by edge", () => {
    const result = selectParlay([
      leg({ id: "low", gameId: 1, modelProb: 0.5, edge: 0.01 }),
      leg({ id: "high", gameId: 1, modelProb: 0.5, edge: 0.08 }),
      leg({ id: "g2", gameId: 2, modelProb: 0.4 }),
      leg({ id: "g3", gameId: 3, modelProb: 0.4 }),
    ]);
    expect(result.legIds?.[0]).toBe("high");
  });

  it("multiplies probabilities and decimal prices", () => {
    expect(combinedModelProbability([0.5, 0.4, 0.25])).toBeCloseTo(0.05, 8);
    expect(combinedDecimalOdds([2, 1.5, 2])).toBeCloseTo(6, 8);
  });

  it("keeps the daily 3-leg pick when asked for three", () => {
    const legs = [
      leg({ id: "a", gameId: 1, modelProb: 0.6, edge: 0.05 }),
      leg({ id: "b", gameId: 1, modelProb: 0.7, edge: -0.01, decimalOdds: 1.5 }),
      leg({ id: "c", gameId: 2, modelProb: 0.5, edge: 0.02 }),
      leg({ id: "d", gameId: 3, modelProb: 0.4, edge: 0.1 }),
      leg({ id: "e", gameId: 4, modelProb: 0.55, edge: 0.01 }),
      leg({ id: "f", gameId: 5, modelProb: 0.9, edge: null, decimalOdds: null }),
    ];
    expect(selectMulti(legs, 3)).toEqual(selectParlay(legs));
    expect(selectMulti(legs, 3).note).toBe(PARLAY_RULE);
  });
});

describe("selectMulti", () => {
  const board = [
    leg({ id: "best", gameId: 1, modelProb: 0.62, edge: 0.04, decimalOdds: 1.8 }),
    leg({ id: "same-game", gameId: 1, modelProb: 0.4, edge: 0.2, decimalOdds: 3 }),
    leg({ id: "negative", gameId: 2, modelProb: 0.9, edge: -0.02, decimalOdds: 1.2 }),
    leg({ id: "unpriced", gameId: 3, modelProb: 0.8, edge: null, decimalOdds: null }),
    leg({ id: "second", gameId: 4, modelProb: 0.51, edge: 0.03, decimalOdds: 2.1 }),
    leg({ id: "third", gameId: 5, modelProb: 0.44, edge: 0.08, decimalOdds: 2.4 }),
    leg({ id: "fourth", gameId: 6, modelProb: 0.33, edge: 0.01, decimalOdds: 3.2 }),
    leg({ id: "cheap", gameId: 7, modelProb: 0.2, edge: 0, decimalOdds: 5 }),
    leg({ id: "flat", gameId: 8, modelProb: 0.7, edge: 0.05, decimalOdds: 1 }),
  ];

  it("takes one positive-edge priced leg per game, highest model chance first", () => {
    expect(selectMulti(board, 2).legIds).toEqual(["best", "second"]);
    expect(selectMulti(board, 4).legIds).toEqual(["best", "second", "third", "fourth"]);
  });

  it("says so when fewer games qualify than the multi needs", () => {
    const result = selectMulti(board, 6);
    expect(result.legIds).toBeNull();
    expect(result.note).toBe(
      "No 6-leg multi. 4 games had a positive-edge price, and the card needs 6 different games.",
    );
  });

  it("uses the same refusal wording as the daily card for three legs", () => {
    const result = selectMulti(
      [leg({ id: "only", gameId: 1, modelProb: 0.5 })],
      3,
    );
    expect(result).toEqual(selectParlay([leg({ id: "only", gameId: 1, modelProb: 0.5 })]));
    expect(result.note).toBe(
      "No 3-leg parlay. 1 game had a positive-edge price, and the card needs 3 different games.",
    );
  });
});
