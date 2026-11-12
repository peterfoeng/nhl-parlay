import { buildDate } from "@/lib/slate/build";
import { fetchSchedule } from "@/lib/nhl/client";
import { chooseOpenSlateDate, melbourneToday, previousDate, shiftDate } from "@/lib/time";
import type { Slate } from "@/lib/types";

export type JobReport = {
  action: string;
  slateDate: string | null;
  games: number;
  legs: number;
  pricedLegs: number;
  parlay: string | null;
  parlayStatus: string | null;
  odds: Array<{ id: string; ok: boolean; skipped?: boolean; quotes: number; error?: string }>;
  gradedLegs: { hit: number; dead: number; void: number; pending: number };
};

export async function runDaily(): Promise<{ featured: JobReport; previous: JobReport | null }> {
  const today = melbourneToday();
  const dates = [shiftDate(today, -2), shiftDate(today, -1), today, shiftDate(today, 1)];
  const games = (
    await Promise.all(
      dates.map(async (date) => {
        try {
          return await fetchSchedule(date);
        } catch (error) {
          console.log(`[job] schedule ${date} failed: ${error instanceof Error ? error.message : error}`);
          return [];
        }
      }),
    )
  ).flat();
  const target = chooseOpenSlateDate(
    games.map((game) => ({
      slateDate: game.slateDate,
      gameState: game.gameState,
      startTimeUtc: game.startTimeUtc,
    })),
  );
  if (!target) throw new Error("No NHL games were found in the Melbourne window.");
  const featuredSlate = await buildDate(target);
  if (!featuredSlate) throw new Error(`NHL slate ${target} had no games.`);
  const previousSlate = await buildDate(previousDate(target));
  return {
    featured: report("featured", featuredSlate),
    previous: previousSlate ? report("previous", previousSlate) : null,
  };
}

export async function runDate(date: string, force = false): Promise<JobReport> {
  const slate = await buildDate(date, { force });
  if (!slate) {
    return {
      action: "empty",
      slateDate: date,
      games: 0,
      legs: 0,
      pricedLegs: 0,
      parlay: null,
      parlayStatus: null,
      odds: [],
      gradedLegs: { hit: 0, dead: 0, void: 0, pending: 0 },
    };
  }
  return report("date", slate);
}

export function report(action: string, slate: Slate): JobReport {
  const counts = { hit: 0, dead: 0, void: 0, pending: 0 };
  for (const leg of slate.legs) counts[leg.status] += 1;
  const parlayLegs = slate.parlay
    ? slate.parlay.legIds
        .map((id) => slate.legs.find((leg) => leg.id === id))
        .filter((leg) => leg != null)
        .map((leg) => `${leg.playerName} ${leg.market}`)
    : null;
  return {
    action,
    slateDate: slate.slateDate,
    games: slate.games.length,
    legs: slate.legs.length,
    pricedLegs: slate.legs.filter((leg) => leg.decimalOdds != null).length,
    parlay: parlayLegs ? parlayLegs.join(" | ") : null,
    parlayStatus: slate.parlay?.status ?? null,
    odds: slate.oddsReport.map((item) => ({
      id: item.id,
      ok: item.ok,
      skipped: item.skipped,
      quotes: item.quotes,
      error: item.error,
    })),
    gradedLegs: counts,
  };
}
