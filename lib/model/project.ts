import { MODEL } from "@/lib/model/constants";

export function projectToiMinutes(
  recentAverage: number | null,
  seasonAverage: number | null,
  recentWeight = MODEL.toiRecentWeight,
): number | null {
  if (recentAverage == null && seasonAverage == null) return null;
  if (recentAverage == null) return seasonAverage;
  if (seasonAverage == null) return recentAverage;
  return recentWeight * recentAverage + (1 - recentWeight) * seasonAverage;
}
