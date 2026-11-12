import { round } from "@/lib/format";
import { isFinalState, isLiveState } from "@/lib/grading/grade";
import { edge, impliedProbability } from "@/lib/odds/decimal";
import { playerIdForQuote } from "@/lib/odds/names";
import type { ProviderResult } from "@/lib/odds/types";
import { combinedDecimalOdds, combinedModelProbability, selectParlay } from "@/lib/parlay/select";
import type { Leg, OddsProviderReport, Slate } from "@/lib/types";

export type PriceRosterPlayer = { id: number; name: string; team: string };

/** A game still to price has not gone live or final, and puck drop is still ahead. */
export function gameStillToPrice(game: { gameState: string; startTimeUtc: string }, now = Date.now()): boolean {
  if (isLiveState(game.gameState) || isFinalState(game.gameState)) return false;
  const start = Date.parse(game.startTimeUtc);
  return Number.isFinite(start) && start > now;
}

export function toOddsReport(results: ProviderResult[]): OddsProviderReport[] {
  return results.map((result) => ({
    id: result.id,
    ok: result.ok,
    ...(result.skipped ? { skipped: true } : {}),
    ...(result.error ? { error: result.error } : {}),
    ...(result.httpStatus != null ? { httpStatus: result.httpStatus } : {}),
    quotes: result.quotes.length,
    ...(result.requestsRemaining != null ? { requestsRemaining: result.requestsRemaining } : {}),
    ...(result.creditsUsed != null ? { creditsUsed: result.creditsUsed } : {}),
    ...(result.fromCache ? { fromCache: true } : {}),
  }));
}

/**
 * Replace prices on games that have not started. Games outside `openGameIds`
 * keep whatever price they already have.
 */
export function repriceOpenLegs(
  legs: Leg[],
  openGameIds: ReadonlySet<number>,
  results: ProviderResult[],
  rosters: Map<string, PriceRosterPlayer[]>,
): void {
  const failed = new Set(results.filter((result) => !result.ok).map((result) => result.id));
  const remembered = new Map<string, Pick<Leg, "decimalOdds" | "impliedProb" | "edge" | "priceSource">>();
  for (const leg of legs) {
    if (!openGameIds.has(leg.gameId)) continue;
    const provider = providerId(leg.priceSource);
    if (provider && failed.has(provider) && leg.decimalOdds != null) {
      remembered.set(leg.id, {
        decimalOdds: leg.decimalOdds,
        impliedProb: leg.impliedProb,
        edge: leg.edge,
        priceSource: leg.priceSource,
      });
    }
    leg.decimalOdds = null;
    leg.impliedProb = null;
    leg.edge = null;
    leg.priceSource = null;
  }
  applyProviderPrices(
    legs.filter((leg) => openGameIds.has(leg.gameId)),
    results,
    rosters,
  );
  for (const leg of legs) {
    const saved = remembered.get(leg.id);
    if (!saved || leg.decimalOdds != null) continue;
    leg.decimalOdds = saved.decimalOdds;
    leg.impliedProb = saved.impliedProb;
    leg.edge = saved.edge;
    leg.priceSource = saved.priceSource;
  }
}

function providerId(source: string | null): string | null {
  if (!source) return null;
  if (source.startsWith("oddsapi")) return "oddsapi";
  return source;
}

/** Copy a previously saved price onto legs in `gameIds`, using the current model probability. */
export function restorePrices(legs: Leg[], saved: Leg[], gameIds: ReadonlySet<number>): void {
  if (!gameIds.size) return;
  const prior = new Map(saved.map((leg) => [leg.id, leg]));
  for (const leg of legs) {
    if (!gameIds.has(leg.gameId)) continue;
    const stored = prior.get(leg.id);
    if (stored?.decimalOdds == null) continue;
    const implied = impliedProbability(stored.decimalOdds);
    const legEdge = implied == null ? null : edge(leg.modelProb, stored.decimalOdds);
    if (implied == null || legEdge == null) continue;
    leg.decimalOdds = stored.decimalOdds;
    leg.impliedProb = round(implied);
    leg.edge = round(legEdge);
    leg.priceSource = stored.priceSource;
  }
}

export function applyProviderPrices(
  legs: Leg[],
  results: ProviderResult[],
  rosters: Map<string, PriceRosterPlayer[]>,
): void {
  const playersByGame = new Map<number, Array<{ id: number; name: string }>>();
  const add = (gameId: number, id: number, name: string) => {
    const list = playersByGame.get(gameId) ?? [];
    if (!list.some((player) => player.id === id)) list.push({ id, name });
    playersByGame.set(gameId, list);
  };
  for (const leg of legs) add(leg.gameId, leg.playerId, leg.playerName);
  for (const roster of rosters.values()) {
    for (const player of roster) {
      for (const leg of legs) {
        if (leg.teamAbbrev !== player.team) continue;
        add(leg.gameId, player.id, player.name);
      }
    }
  }

  for (const leg of legs) {
    const players = playersByGame.get(leg.gameId) ?? [{ id: leg.playerId, name: leg.playerName }];
    for (const result of results) {
      const quote = result.quotes.find((item) => {
        if (item.gameId !== leg.gameId || item.market !== leg.market) return false;
        return playerIdForQuote(item.playerName, players) === leg.playerId;
      });
      if (!quote) continue;
      const implied = impliedProbability(quote.decimalOdds);
      const legEdge = edge(leg.modelProb, quote.decimalOdds);
      if (implied == null || legEdge == null) continue;
      leg.decimalOdds = round(quote.decimalOdds, 4);
      leg.impliedProb = round(implied);
      leg.edge = round(legEdge);
      leg.priceSource = quote.source;
      break;
    }
  }
}

/**
 * Keep a parlay that already includes a started game. Otherwise pick again
 * from the games that are still eligible.
 */
export function syncParlay(slate: Slate, eligibleGameIds: ReadonlySet<number>, emptyNoteSuffix = ""): void {
  const locked = slate.parlay?.legIds.some((id) => {
    const leg = slate.legs.find((item) => item.id === id);
    return leg != null && !eligibleGameIds.has(leg.gameId);
  });
  if (slate.parlay && locked) {
    const chosen = slate.parlay.legIds
      .map((id) => slate.legs.find((leg) => leg.id === id))
      .filter((leg): leg is Leg => leg != null);
    if (chosen.length === 3 && chosen.every((leg) => leg.decimalOdds != null && leg.decimalOdds > 1)) {
      slate.parlay.decimalOdds = round(
        combinedDecimalOdds(chosen.map((leg) => leg.decimalOdds ?? 0)),
        4,
      );
      const implied = impliedProbability(slate.parlay.decimalOdds) ?? 0;
      slate.parlay.impliedProb = round(implied);
      slate.parlay.edge = round(slate.parlay.modelProb - implied);
    }
    return;
  }

  const selection = selectParlay(
    slate.legs
      .filter((leg) => eligibleGameIds.has(leg.gameId))
      .map((leg) => ({
        id: leg.id,
        gameId: leg.gameId,
        modelProb: leg.modelProb,
        decimalOdds: leg.decimalOdds,
        edge: leg.edge,
      })),
  );
  const chosen = (selection.legIds ?? [])
    .map((id) => slate.legs.find((leg) => leg.id === id))
    .filter((leg): leg is Leg => Boolean(leg));
  if (chosen.length !== 3) {
    slate.parlay = null;
    slate.parlayNote = `${selection.note}${emptyNoteSuffix}`;
    return;
  }
  const decimalOdds = round(
    combinedDecimalOdds(chosen.map((leg) => leg.decimalOdds ?? 0)),
    4,
  );
  const modelProb = round(combinedModelProbability(chosen.map((leg) => leg.modelProb)));
  const implied = impliedProbability(decimalOdds) ?? 0;
  slate.parlay = {
    legIds: chosen.map((leg) => leg.id),
    decimalOdds,
    modelProb,
    impliedProb: round(implied),
    edge: round(modelProb - implied),
    status: "ALIVE",
    hitCount: 0,
  };
  slate.parlayNote = selection.note;
}
