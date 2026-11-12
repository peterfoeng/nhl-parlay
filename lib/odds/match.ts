import { normalizeName } from "@/lib/odds/names";

export type MatchableGame = {
  id: number;
  startTimeUtc: string;
  awayCommon: string;
  homeCommon: string;
};

/** Match a book event to a slate game by nickname and start time. */
export function matchEventToGame(
  event: { away: string; home: string; startsAt: string },
  games: MatchableGame[],
): MatchableGame | null {
  const start = Date.parse(event.startsAt);
  if (!Number.isFinite(start)) return null;
  const hits = games.filter((game) => {
    const delta = Math.abs(Date.parse(game.startTimeUtc) - start);
    if (delta > 3 * 60 * 60 * 1000) return false;
    return sideHas(event.away, game.awayCommon) && sideHas(event.home, game.homeCommon);
  });
  return hits.length === 1 ? hits[0] : null;
}

function sideHas(label: string, common: string): boolean {
  const nick = normalizeName(common);
  if (!nick) return false;
  return normalizeName(label).includes(nick);
}
