import { applyProgress, gameNeedsBox, shouldPoll } from "@/lib/slate/build";
import { syncTrackedGrades } from "@/lib/multis/persist";
import { getStore } from "@/lib/storage";
import type { TrackedMulti } from "@/lib/types";

export async function GET(request: Request) {
  const date = new URL(request.url).searchParams.get("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Response.json({ error: "date is required (YYYY-MM-DD)" }, { status: 400 });
  }
  const stored = await getStore().getSlate(date);
  if (!stored) return Response.json({ error: "No slate saved for that date" }, { status: 404 });

  const refresh = stored.games.some((game) =>
    gameNeedsBox(
      game,
      stored.legs.filter((leg) => leg.gameId === game.id),
    ),
  );
  const slate = refresh ? await applyProgress(stored) : stored;
  let tracked: TrackedMulti[] | undefined;
  try {
    const graded = await syncTrackedGrades([slate]);
    tracked = graded.filter((multi) => multi.slateDate === date);
  } catch (error) {
    console.log(`[multis] live grade skipped: ${error instanceof Error ? error.message : error}`);
  }
  return Response.json(
    { slate, poll: shouldPoll(slate), asOf: new Date().toISOString(), ...(tracked ? { tracked } : {}) },
    { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=30" } },
  );
}
