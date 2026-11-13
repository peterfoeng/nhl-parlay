import { buildTrackedMulti, canRemoveTrackedMulti, gradeTrackedMulti, sameLegSet } from "@/lib/multis/track";
import { getStore } from "@/lib/storage";
import type { Slate, TrackedMulti } from "@/lib/types";

export type SavedMulti =
  | { ok: true; multi: TrackedMulti; existing: boolean }
  | { ok: false; note: string };

export type RemovedMulti = { ok: true } | { ok: false; note: string; missing: boolean };

export async function saveBuiltMulti(slate: Slate, size: number, now = new Date()): Promise<SavedMulti> {
  const built = buildTrackedMulti(slate, size, now);
  if (!built.ok) return built;
  const store = getStore();
  const existing = await store.listTrackedMultis(slate.slateDate);
  const match = existing.find((multi) => sameLegSet(multi, built.multi.legs.map((leg) => leg.id)));
  if (match) return { ok: true, multi: match, existing: true };
  await store.putTrackedMulti(built.multi);
  return { ok: true, multi: built.multi, existing: false };
}

export async function removeTrackedMulti(id: string, now = Date.now()): Promise<RemovedMulti> {
  const store = getStore();
  const multi = await store.getTrackedMulti(id);
  if (!multi) return { ok: false, note: "That multi is not saved.", missing: true };
  if (!canRemoveTrackedMulti(multi, now)) {
    return {
      ok: false,
      missing: false,
      note: "This multi cannot be removed because a game has started.",
    };
  }
  await store.deleteTrackedMulti(id);
  return { ok: true };
}

export async function readTracked(slates: Slate[]): Promise<TrackedMulti[]> {
  try {
    return await syncTrackedGrades(slates);
  } catch (error) {
    console.log(`[multis] read skipped: ${error instanceof Error ? error.message : error}`);
    return [];
  }
}

/** Write grades for every tracked multi whose slate is in `slates`. Unchanged rows are left alone. */
export async function syncTrackedGrades(slates: Slate[]): Promise<TrackedMulti[]> {
  const store = getStore();
  const saved = await store.listTrackedMultis();
  const byDate = new Map(slates.map((slate) => [slate.slateDate, slate]));
  const graded = saved.map((multi) => gradeTrackedMulti(multi, byDate.get(multi.slateDate) ?? null));
  await Promise.all(
    graded.map((multi, index) => {
      if (gradeSignature(multi) === gradeSignature(saved[index])) return Promise.resolve();
      return store.putTrackedMulti(multi);
    }),
  );
  return graded;
}

function gradeSignature(multi: TrackedMulti): string {
  return JSON.stringify({
    status: multi.status,
    hitCount: multi.hitCount,
    legs: multi.legs.map((leg) => [leg.id, leg.status, leg.current, leg.clockLabel, leg.gameState]),
  });
}
