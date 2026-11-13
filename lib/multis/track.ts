import { gradeParlay, hitCount, isFinalState, isLiveState, type ParlayStatus } from "@/lib/grading/grade";
import { sourceLabel, round } from "@/lib/format";
import { impliedProbability } from "@/lib/odds/decimal";
import { combinedDecimalOdds, combinedModelProbability, selectMulti } from "@/lib/parlay/select";
import { formatMelbourneStamp } from "@/lib/time";
import type { Leg, Slate, TrackedLeg, TrackedMulti } from "@/lib/types";

export const MULTI_SIZES = [2, 3, 4, 5, 6] as const;
export type MultiSize = (typeof MULTI_SIZES)[number];

const POLL_BEFORE_MS = 30 * 60 * 1000;
const POLL_AFTER_MS = 6 * 60 * 60 * 1000;

export function isMultiSize(value: number): value is MultiSize {
  return MULTI_SIZES.some((size) => size === value);
}

export type BuiltMulti =
  | { ok: true; multi: TrackedMulti }
  | { ok: false; note: string };

/** Snapshot the N-leg selection. Prices and model chances are copied, not referenced. */
export function buildTrackedMulti(slate: Slate, size: number, now = new Date()): BuiltMulti {
  if (!isMultiSize(size)) {
    return { ok: false, note: "Choose a multi from 2 to 6 legs." };
  }
  const selection = selectMulti(
    slate.legs.map((leg) => ({
      id: leg.id,
      gameId: leg.gameId,
      modelProb: leg.modelProb,
      decimalOdds: leg.decimalOdds,
      edge: leg.edge,
    })),
    size,
  );
  if (!selection.legIds) return { ok: false, note: selection.note };

  const chosen = selection.legIds
    .map((id) => slate.legs.find((leg) => leg.id === id))
    .filter((leg): leg is Leg => leg != null);
  if (chosen.length !== size || chosen.some((leg) => leg.decimalOdds == null || leg.edge == null || leg.edge <= 0)) {
    return { ok: false, note: selection.note };
  }

  const decimalOdds = round(
    combinedDecimalOdds(chosen.map((leg) => leg.decimalOdds ?? 0)),
    4,
  );
  const modelProb = round(combinedModelProbability(chosen.map((leg) => leg.modelProb)));
  const implied = impliedProbability(decimalOdds) ?? 0;
  const savedAt = now.toISOString();
  const statuses = chosen.map((leg) => leg.status);
  return {
    ok: true,
    multi: {
      id: crypto.randomUUID(),
      slateDate: slate.slateDate,
      size,
      savedAt,
      savedLabel: formatMelbourneStamp(savedAt),
      legs: chosen.map(toTrackedLeg),
      decimalOdds,
      modelProb,
      impliedProb: round(implied),
      edge: round(modelProb - implied),
      status: gradeParlay(statuses),
      hitCount: hitCount(statuses),
    },
  };
}

export function sameLegSet(multi: Pick<TrackedMulti, "legs">, legIds: string[]): boolean {
  if (multi.legs.length !== legIds.length) return false;
  const saved = multi.legs.map((leg) => leg.id).sort();
  const next = [...legIds].sort();
  return saved.every((id, index) => id === next[index]);
}

/**
 * Copy live leg progress off the slate. Prices, model chances and the saved
 * time stay as they were when the multi was tracked.
 */
export function gradeTrackedMulti(multi: TrackedMulti, slate: Slate | null): TrackedMulti {
  if (!slate || slate.slateDate !== multi.slateDate) return multi;
  const legs = multi.legs.map((leg) => {
    const live = slate.legs.find((item) => item.id === leg.id);
    if (!live) return leg;
    return {
      ...leg,
      status: live.status,
      current: live.current,
      clockLabel: live.clockLabel,
      gameState: live.gameState,
    };
  });
  const statuses = legs.map((leg) => leg.status);
  return {
    ...multi,
    legs,
    status: gradeParlay(statuses),
    hitCount: hitCount(statuses),
  };
}

export function canRemoveTrackedMulti(multi: TrackedMulti, now = Date.now()): boolean {
  return multi.legs.every((leg) => {
    if (isLiveState(leg.gameState) || isFinalState(leg.gameState)) return false;
    const start = Date.parse(leg.startTimeUtc);
    return Number.isFinite(start) && start > now;
  });
}

/** True while a game is on, or within the same window the slate already polls. */
export function multiNeedsPoll(multi: TrackedMulti, now = Date.now()): boolean {
  if (multi.status !== "ALIVE") return false;
  return multi.legs.some((leg) => {
    const start = Date.parse(leg.startTimeUtc);
    if (!Number.isFinite(start)) return false;
    return now >= start - POLL_BEFORE_MS && now <= start + POLL_AFTER_MS;
  });
}

export function trackedRecord(multis: Array<Pick<TrackedMulti, "size" | "status">>): {
  won: number;
  lost: number;
  voided: number;
  open: number;
  bySize: Array<{ size: number; won: number; lost: number; voided: number; open: number }>;
} {
  const bySize = new Map<number, { size: number; won: number; lost: number; voided: number; open: number }>();
  let won = 0;
  let lost = 0;
  let voided = 0;
  let open = 0;
  for (const multi of multis) {
    const row = bySize.get(multi.size) ?? { size: multi.size, won: 0, lost: 0, voided: 0, open: 0 };
    addStatus(multi.status, row);
    if (multi.status === "WON") won += 1;
    else if (multi.status === "LOST") lost += 1;
    else if (multi.status === "VOID") voided += 1;
    else open += 1;
    bySize.set(multi.size, row);
  }
  return {
    won,
    lost,
    voided,
    open,
    bySize: [...bySize.values()].sort((a, b) => a.size - b.size),
  };
}

function addStatus(
  status: ParlayStatus,
  row: { won: number; lost: number; voided: number; open: number },
): void {
  if (status === "WON") row.won += 1;
  else if (status === "LOST") row.lost += 1;
  else if (status === "VOID") row.voided += 1;
  else row.open += 1;
}

export function toTrackedLeg(leg: Leg): TrackedLeg {
  return {
    id: leg.id,
    gameId: leg.gameId,
    playerId: leg.playerId,
    playerName: leg.playerName,
    teamAbbrev: leg.teamAbbrev,
    market: leg.market,
    matchup: leg.matchup,
    modelProb: leg.modelProb,
    decimalOdds: leg.decimalOdds ?? 0,
    edge: leg.edge ?? 0,
    priceSource: leg.priceSource,
    book: sourceLabel(leg.priceSource),
    headshot: leg.headshot,
    teamLogo: leg.teamLogo,
    target: leg.target,
    startTimeUtc: leg.startTimeUtc,
    status: leg.status,
    current: leg.current,
    clockLabel: leg.clockLabel,
    gameState: leg.gameState,
  };
}
