import { MARKETS, type MarketId } from "@/lib/model/constants";

export const BOARD_PREVIEW = 20;
export const BOARD_PAGE_SIZE = 25;
export const BOARD_PER_GAME = 3;

export const MARKET_CHIP: Record<MarketId, string> = {
  anytime_goal: "Goal",
  anytime_point: "Point",
  sog_over_15: "1.5 shots",
  sog_over_25: "2.5 shots",
};

const MARKET_QUERY: Record<MarketId, string> = {
  anytime_goal: "goal",
  anytime_point: "point",
  sog_over_15: "sog15",
  sog_over_25: "sog25",
};

const QUERY_MARKET: Record<string, MarketId> = {
  goal: "anytime_goal",
  point: "anytime_point",
  sog15: "sog_over_15",
  sog25: "sog_over_25",
  anytime_goal: "anytime_goal",
  anytime_point: "anytime_point",
  sog_over_15: "sog_over_15",
  sog_over_25: "sog_over_25",
};

export type BoardSort = "edge" | "model";
export type BoardView = "top" | "game" | "all";

export type BoardQuery = {
  markets: MarketId[];
  gameId: number | null;
  pricedOnly: boolean;
  positiveEdgeOnly: boolean;
  sort: BoardSort;
  view: BoardView;
  page: number;
};

export type BoardLeg = {
  id: string;
  gameId: number;
  playerName: string;
  matchup: string;
  market: MarketId;
  modelProb: number;
  decimalOdds: number | null;
  edge: number | null;
};

export type BoardGroup<T> = {
  gameId: number;
  label: string;
  legs: T[];
};

export type BoardSelection<T> = {
  rows: T[];
  groups: BoardGroup<T>[] | null;
  total: number;
  shown: number;
  page: number;
  pages: number;
  view: BoardView;
};

const BOARD_KEYS = ["market", "game", "priced", "edge", "sort", "view", "page"] as const;

export function defaultBoardQuery(): BoardQuery {
  return {
    markets: [],
    gameId: null,
    pricedOnly: true,
    positiveEdgeOnly: true,
    sort: "edge",
    view: "top",
    page: 1,
  };
}

export function parseBoardQuery(params: URLSearchParams): BoardQuery {
  const markets = MARKETS.filter((id) => {
    const tokens = (params.get("market") ?? "").split(",").map((token) => token.trim()).filter(Boolean);
    return tokens.some((token) => QUERY_MARKET[token] === id);
  });
  const gameRaw = params.get("game");
  const gameId = gameRaw && /^\d+$/.test(gameRaw) ? Number(gameRaw) : null;
  const viewParam = params.get("view");
  const view: BoardView = viewParam === "all" || viewParam === "game" ? viewParam : "top";
  const pageRaw = Number.parseInt(params.get("page") ?? "1", 10);
  return {
    markets,
    gameId,
    pricedOnly: params.get("priced") !== "0",
    positiveEdgeOnly: params.get("edge") !== "0",
    sort: params.get("sort") === "model" ? "model" : "edge",
    view,
    page: view === "all" && Number.isFinite(pageRaw) && pageRaw > 1 ? pageRaw : 1,
  };
}

export function serializeBoardQuery(query: BoardQuery): string {
  const params = new URLSearchParams();
  if (query.markets.length > 0) {
    params.set("market", query.markets.map((id) => MARKET_QUERY[id]).join(","));
  }
  if (query.gameId != null) params.set("game", String(query.gameId));
  if (!query.pricedOnly) params.set("priced", "0");
  if (!query.positiveEdgeOnly) params.set("edge", "0");
  if (query.sort === "model") params.set("sort", "model");
  if (query.view === "game") params.set("view", "game");
  if (query.view === "all") {
    params.set("view", "all");
    if (query.page > 1) params.set("page", String(query.page));
  }
  return params.toString().replaceAll("%2C", ",");
}

/** Keep unrelated params (the multi builder's `legs`, for example) and replace the board ones. */
export function withBoardQuery(current: URLSearchParams, query: BoardQuery): string {
  const next = new URLSearchParams(current);
  for (const key of BOARD_KEYS) next.delete(key);
  const board = new URLSearchParams(serializeBoardQuery(query));
  for (const [key, value] of board) next.set(key, value);
  return next.toString();
}

export function selectBoard<T extends BoardLeg>(legs: T[], query: BoardQuery): BoardSelection<T> {
  const filtered = legs.filter((leg) => matches(leg, query));
  const sorted = filtered.toSorted((a, b) => compareLegs(a, b, query.sort));

  if (query.view === "game") {
    const groups = groupBest(sorted, BOARD_PER_GAME);
    const rows = groups.flatMap((group) => group.legs);
    return {
      rows,
      groups,
      total: sorted.length,
      shown: rows.length,
      page: 1,
      pages: 1,
      view: "game",
    };
  }

  if (query.view === "all") {
    const pages = Math.max(1, Math.ceil(sorted.length / BOARD_PAGE_SIZE));
    const page = Math.min(Math.max(query.page, 1), pages);
    const start = (page - 1) * BOARD_PAGE_SIZE;
    const rows = sorted.slice(start, start + BOARD_PAGE_SIZE);
    return {
      rows,
      groups: null,
      total: sorted.length,
      shown: rows.length,
      page,
      pages,
      view: "all",
    };
  }

  const rows = sorted.slice(0, BOARD_PREVIEW);
  return {
    rows,
    groups: null,
    total: sorted.length,
    shown: rows.length,
    page: 1,
    pages: 1,
    view: "top",
  };
}

function matches(leg: BoardLeg, query: BoardQuery): boolean {
  if (query.markets.length > 0 && !query.markets.includes(leg.market)) return false;
  if (query.gameId != null && leg.gameId !== query.gameId) return false;
  if (query.pricedOnly && !(leg.decimalOdds != null && leg.decimalOdds > 1)) return false;
  if (query.positiveEdgeOnly && !(leg.edge != null && leg.edge > 0)) return false;
  return true;
}

function compareLegs(a: BoardLeg, b: BoardLeg, sort: BoardSort): number {
  if (sort === "model" && b.modelProb !== a.modelProb) return b.modelProb - a.modelProb;
  const edgeDelta = (b.edge ?? Number.NEGATIVE_INFINITY) - (a.edge ?? Number.NEGATIVE_INFINITY);
  if (edgeDelta !== 0) return edgeDelta;
  if (b.modelProb !== a.modelProb) return b.modelProb - a.modelProb;
  return a.playerName.localeCompare(b.playerName);
}

function groupBest<T extends BoardLeg>(sorted: T[], limit: number): BoardGroup<T>[] {
  const groups: BoardGroup<T>[] = [];
  const index = new Map<number, BoardGroup<T>>();
  for (const leg of sorted) {
    let group = index.get(leg.gameId);
    if (!group) {
      group = { gameId: leg.gameId, label: leg.matchup, legs: [] };
      index.set(leg.gameId, group);
      groups.push(group);
    }
    if (group.legs.length < limit) group.legs.push(leg);
  }
  return groups;
}
