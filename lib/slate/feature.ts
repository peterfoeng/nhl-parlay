import type { Slate } from "@/lib/types";

/** Prefer the earliest slate whose daily parlay is still alive. Otherwise the newest saved slate. */
export function pickFeatured(slates: Slate[]): Slate | null {
  if (!slates.length) return null;
  const alive = slates
    .filter((slate) => slate.parlay?.status === "ALIVE")
    .sort((a, b) => a.slateDate.localeCompare(b.slateDate));
  if (alive.length) return alive[0];
  return [...slates].sort((a, b) => b.slateDate.localeCompare(a.slateDate))[0];
}
