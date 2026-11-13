import { describe, expect, it } from "vitest";
import {
  BOARD_PAGE_SIZE,
  BOARD_PREVIEW,
  parseBoardQuery,
  selectBoard,
  serializeBoardQuery,
  type BoardLeg,
} from "@/lib/board/view";

function row(partial: Partial<BoardLeg> & Pick<BoardLeg, "id" | "gameId">): BoardLeg {
  return {
    playerName: partial.id,
    matchup: `A @ B ${partial.gameId}`,
    market: "anytime_goal",
    modelProb: 0.4,
    decimalOdds: 2,
    edge: 0.05,
    ...partial,
  };
}

describe("selectBoard", () => {
  const legs = [
    row({ id: "neg", gameId: 1, edge: -0.04, modelProb: 0.8, decimalOdds: 1.2 }),
    row({ id: "none", gameId: 1, edge: null, decimalOdds: null, modelProb: 0.9 }),
    row({ id: "low", gameId: 2, edge: 0.01, modelProb: 0.3 }),
    row({ id: "high", gameId: 3, edge: 0.2, modelProb: 0.5, market: "anytime_point" }),
    row({ id: "mid", gameId: 3, edge: 0.1, modelProb: 0.7, market: "sog_over_15" }),
    ...Array.from({ length: 30 }, (_, index) =>
      row({
        id: `p${index}`,
        gameId: 10 + (index % 6),
        edge: 0.03 + index / 1000,
        modelProb: 0.2 + (index % 5) / 20,
        market: index % 2 === 0 ? "anytime_goal" : "sog_over_25",
      }),
    ),
  ];

  it("defaults to priced, positive-edge legs, highest edge first, capped at 20", () => {
    const selected = selectBoard(legs, parseBoardQuery(new URLSearchParams()));
    expect(selected.view).toBe("top");
    expect(selected.shown).toBe(BOARD_PREVIEW);
    expect(selected.total).toBe(legs.length - 2);
    expect(selected.rows[0].id).toBe("high");
    expect(selected.rows.some((leg) => leg.id === "neg" || leg.id === "none")).toBe(false);
    expect(selected.rows.map((leg) => leg.edge)).toEqual(
      [...selected.rows].map((leg) => leg.edge).sort((a, b) => (b ?? 0) - (a ?? 0)),
    );
  });

  it("filters by market and game", () => {
    const goals = selectBoard(legs, parseBoardQuery(new URLSearchParams("market=goal")));
    expect(goals.rows.every((leg) => leg.market === "anytime_goal")).toBe(true);
    const game = selectBoard(legs, parseBoardQuery(new URLSearchParams("game=3")));
    expect(game.rows.map((leg) => leg.id)).toEqual(["high", "mid"]);
  });

  it("paginates the full list at 25 per page", () => {
    const query = parseBoardQuery(new URLSearchParams("view=all&page=2"));
    const selected = selectBoard(legs, query);
    expect(selected.page).toBe(2);
    expect(selected.shown).toBe(selected.total - BOARD_PAGE_SIZE);
    expect(selected.rows).toHaveLength(selected.total - BOARD_PAGE_SIZE);
    const first = selectBoard(legs, parseBoardQuery(new URLSearchParams("view=all")));
    expect(first.rows).toHaveLength(BOARD_PAGE_SIZE);
    expect(selected.rows[0].id).not.toBe(first.rows[0].id);
  });

  it("groups each game's best three legs", () => {
    const selected = selectBoard(legs, parseBoardQuery(new URLSearchParams("view=game")));
    const gameTen = selected.groups?.find((group) => group.gameId === 10);
    expect(gameTen?.legs).toHaveLength(3);
    expect(gameTen?.legs.map((leg) => leg.edge)).toEqual(
      [...(gameTen?.legs ?? [])].map((leg) => leg.edge).sort((a, b) => (b ?? 0) - (a ?? 0)),
    );
  });

  it("can show unpriced legs when the default toggles are off", () => {
    const selected = selectBoard(
      [row({ id: "none", gameId: 1, edge: null, decimalOdds: null }), row({ id: "priced", gameId: 2 })],
      parseBoardQuery(new URLSearchParams("priced=0&edge=0&view=all")),
    );
    expect(selected.total).toBe(2);
    expect(selected.rows.map((leg) => leg.id)).toContain("none");
  });

  it("round-trips the query and leaves the defaults out of the URL", () => {
    expect(serializeBoardQuery(parseBoardQuery(new URLSearchParams()))).toBe("");
    const raw = "market=goal,point&game=12&sort=model&view=all&page=2";
    expect(serializeBoardQuery(parseBoardQuery(new URLSearchParams(raw)))).toBe(raw);
  });
});
