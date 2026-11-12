import { describe, expect, it } from "vitest";
import {
  combinedDecimalOdds,
  combinedModelProbability,
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
});
