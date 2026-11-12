import { getText, mapPool } from "@/lib/http";
import { matchEventToGame, type MatchableGame } from "@/lib/odds/match";
import { quotesFromOddsApi } from "@/lib/odds/odds-api";
import { quotesFromPointsbetEvent, type PointsBetMarket } from "@/lib/odds/pointsbet";
import { quotesFromSportsbetPayload } from "@/lib/odds/classify";
import type { ProviderResult, PriceQuote } from "@/lib/odds/types";
import type { ScheduledGame } from "@/lib/types";

const SPORTS_ROOT = "https://www.sportsbet.com.au/apigw/sportsbook-sports/Sportsbook/Sports";
const POINTS_ROOT = "https://api.au.pointsbet.com";

export async function fetchAllOdds(games: ScheduledGame[]): Promise<ProviderResult[]> {
  const order = (process.env.ODDS_PROVIDERS || "sportsbet,pointsbet,oddsapi")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  const runners: Record<string, () => Promise<ProviderResult>> = {
    sportsbet: () => fetchSportsbet(games),
    pointsbet: () => fetchPointsbet(games),
    oddsapi: () => fetchOddsApi(games),
  };
  const results: ProviderResult[] = [];
  for (const id of order) {
    const run = runners[id];
    if (!run) continue;
    try {
      results.push(await run());
    } catch (error) {
      results.push({
        id,
        ok: false,
        error: error instanceof Error ? error.message : "Odds provider failed",
        quotes: [],
      });
    }
  }
  return results;
}

export async function fetchSportsbet(games: ScheduledGame[]): Promise<ProviderResult> {
  const response = await getText(SPORTS_ROOT, {
    headers: { Referer: "https://www.sportsbet.com.au/" },
    timeoutMs: 20000,
  });
  if (!response.ok || response.text.trim().startsWith("<")) {
    const blocked = response.status === 403 || /location error/i.test(response.text);
    return {
      id: "sportsbet",
      ok: false,
      httpStatus: response.status,
      error: blocked
        ? `Sportsbet HTTP ${response.status} location block. The public site refused this IP, which is common for datacenters and non-AU networks.`
        : `Sportsbet HTTP ${response.status}`,
      quotes: [],
    };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(response.text);
  } catch {
    return { id: "sportsbet", ok: false, httpStatus: response.status, error: "Sportsbet did not return JSON.", quotes: [] };
  }

  const competition = findNhlCompetition(payload);
  if (!competition) {
    return {
      id: "sportsbet",
      ok: false,
      error: "Sportsbet responded, but no NHL competition id was in the sports list.",
      quotes: [],
    };
  }

  const events = await loadSportsbetEvents(competition);
  const matched = pairEvents(events, games);
  const quotes: PriceQuote[] = [];
  await mapPool(matched, 4, async ({ game, eventId }) => {
    const markets = await loadSportsbetMarkets(eventId);
    if (markets) quotes.push(...quotesFromSportsbetPayload(game.id, markets));
  });
  return { id: "sportsbet", ok: true, quotes };
}

export async function fetchPointsbet(games: ScheduledGame[]): Promise<ProviderResult> {
  const list = await getText(`${POINTS_ROOT}/api/v2/sports/list`);
  if (!list.ok) {
    return { id: "pointsbet", ok: false, httpStatus: list.status, error: `PointsBet HTTP ${list.status}`, quotes: [] };
  }
  let sports: { sports?: Array<{ key?: string; competitions?: Array<{ key?: string; name?: string }> }> };
  try {
    sports = JSON.parse(list.text);
  } catch {
    return { id: "pointsbet", ok: false, error: "PointsBet sports list was not JSON.", quotes: [] };
  }
  const hockey = (sports.sports ?? []).find((sport) => sport.key === "ice-hockey");
  const competition = (hockey?.competitions ?? []).find((item) => item.name?.toLowerCase() === "nhl");
  if (!competition?.key) {
    return { id: "pointsbet", ok: false, error: "PointsBet has no NHL competition in the sports list.", quotes: [] };
  }

  const events: PointsBetListEvent[] = [];
  for (let page = 1; page <= 4; page += 1) {
    const response = await getText(
      `${POINTS_ROOT}/api/v2/competitions/${competition.key}/events/featured?includeLive=true&page=${page}`,
    );
    if (!response.ok) {
      if (page === 1) {
        return { id: "pointsbet", ok: false, httpStatus: response.status, error: `PointsBet events HTTP ${response.status}`, quotes: [] };
      }
      break;
    }
    const body = JSON.parse(response.text) as { events?: PointsBetListEvent[]; nextPage?: unknown };
    events.push(...(body.events ?? []));
    if (!body.nextPage) break;
  }

  const matched: Array<{ gameId: number; eventKey: string }> = [];
  for (const event of events) {
    if (!event.key || !event.awayTeam || !event.homeTeam || !event.startsAt) continue;
    const game = matchEventToGame(
      { away: event.awayTeam, home: event.homeTeam, startsAt: event.startsAt },
      toMatchable(games),
    );
    if (game) matched.push({ gameId: game.id, eventKey: event.key });
  }

  const quotes: PriceQuote[] = [];
  await mapPool(matched, 4, async (item) => {
    const response = await getText(`${POINTS_ROOT}/api/v2/events/${item.eventKey}`);
    if (!response.ok) return;
    const body = JSON.parse(response.text) as { fixedOddsMarkets?: PointsBetMarket[] };
    quotes.push(...quotesFromPointsbetEvent(item.gameId, body));
  });
  return { id: "pointsbet", ok: true, quotes };
}

export async function fetchOddsApi(games: ScheduledGame[]): Promise<ProviderResult> {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) {
    return { id: "oddsapi", ok: false, skipped: true, error: "ODDS_API_KEY is not set.", quotes: [] };
  }
  const eventsResponse = await getText(
    `https://api.the-odds-api.com/v4/sports/icehockey_nhl/events?apiKey=${encodeURIComponent(apiKey)}`,
  );
  if (!eventsResponse.ok) {
    return {
      id: "oddsapi",
      ok: false,
      httpStatus: eventsResponse.status,
      error: `The Odds API HTTP ${eventsResponse.status}: ${redact(eventsResponse.text)}`,
      quotes: [],
    };
  }
  const events = JSON.parse(eventsResponse.text) as OddsApiEvent[];
  const matched: Array<{ gameId: number; eventId: string }> = [];
  for (const event of events) {
    if (!event.id || !event.commence_time || !event.away_team || !event.home_team) continue;
    const game = matchEventToGame(
      { away: event.away_team, home: event.home_team, startsAt: event.commence_time },
      toMatchable(games),
    );
    if (game) matched.push({ gameId: game.id, eventId: event.id });
  }

  const quotes: PriceQuote[] = [];
  const markets = "player_goal_scorer_anytime,player_points,player_shots_on_goal";
  await mapPool(matched, 3, async (item) => {
    const url =
      `https://api.the-odds-api.com/v4/sports/icehockey_nhl/events/${item.eventId}/odds` +
      `?apiKey=${encodeURIComponent(apiKey)}&regions=au&markets=${markets}&oddsFormat=decimal`;
    const response = await getText(url);
    if (!response.ok) return;
    const body = JSON.parse(response.text) as { bookmakers?: Parameters<typeof quotesFromOddsApi>[1] };
    quotes.push(...quotesFromOddsApi(item.gameId, body.bookmakers ?? []));
  });
  return { id: "oddsapi", ok: true, quotes };
}

function redact(text: string): string {
  const key = process.env.ODDS_API_KEY;
  const cleaned = key ? text.replaceAll(key, "REDACTED") : text;
  return cleaned.replace(/\s+/g, " ").slice(0, 180);
}

type CompetitionRef = { id: string; classId?: string };

function findNhlCompetition(payload: unknown): CompetitionRef | null {
  let found: CompetitionRef | null = null;
  const visit = (node: unknown, iceHockey: boolean) => {
    if (found || !node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, iceHockey);
      return;
    }
    const record = node as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name : "";
    const nextIce = iceHockey || /ice hockey/i.test(name);
    const id = record.id ?? record.competitionId;
    if (nextIce && /^nhl$/i.test(name) && (typeof id === "number" || typeof id === "string")) {
      const classId = record.classId ?? record.class_id;
      found = {
        id: String(id),
        classId: typeof classId === "number" || typeof classId === "string" ? String(classId) : undefined,
      };
      return;
    }
    for (const value of Object.values(record)) visit(value, nextIce);
  };
  visit(payload, false);
  return found;
}

type ListedEvent = { id: string; away: string; home: string; startsAt: string };

async function loadSportsbetEvents(competition: CompetitionRef): Promise<ListedEvent[]> {
  const urls = [
    competition.classId ? `${SPORTS_ROOT}/${competition.classId}/Competitions/${competition.id}/Events` : "",
    `${SPORTS_ROOT}/Competitions/${competition.id}/Events`,
    `${SPORTS_ROOT}/Events?competitionId=${competition.id}`,
  ].filter(Boolean);
  for (const url of urls) {
    const response = await getText(url, { headers: { Referer: "https://www.sportsbet.com.au/" } });
    if (!response.ok || response.text.trim().startsWith("<")) continue;
    try {
      const events = collectEvents(JSON.parse(response.text));
      if (events.length) return events;
    } catch {
      continue;
    }
  }
  return [];
}

async function loadSportsbetMarkets(eventId: string): Promise<unknown | null> {
  const urls = [`${SPORTS_ROOT}/Events/${eventId}/Markets`, `${SPORTS_ROOT}/Events/${eventId}/SportCard`];
  for (const url of urls) {
    const response = await getText(url, { headers: { Referer: "https://www.sportsbet.com.au/" } });
    if (!response.ok || response.text.trim().startsWith("<")) continue;
    try {
      return JSON.parse(response.text);
    } catch {
      continue;
    }
  }
  return null;
}

function collectEvents(payload: unknown): ListedEvent[] {
  const events: ListedEvent[] = [];
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    const record = node as Record<string, unknown>;
    const listed = readListedEvent(record);
    if (listed) events.push(listed);
    for (const value of Object.values(record)) {
      if (value && typeof value === "object") visit(value);
    }
  };
  visit(payload);
  return events;
}

function readListedEvent(record: Record<string, unknown>): ListedEvent | null {
  const id = record.id ?? record.eventId;
  if (typeof id !== "number" && typeof id !== "string") return null;
  const start = readStart(record);
  if (!start) return null;
  const away = teamLabel(record.awayTeam) || teamLabel(record.participant1) || splitName(record.name, 0);
  const home = teamLabel(record.homeTeam) || teamLabel(record.participant2) || splitName(record.name, 1);
  if (!away || !home) return null;
  return { id: String(id), away, home, startsAt: start };
}

function teamLabel(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  const name = record.name ?? record.teamName;
  return typeof name === "string" ? name : "";
}

function splitName(value: unknown, index: number): string {
  if (typeof value !== "string") return "";
  const parts = value.split(/\s+(?:@|at|vs\.?|v)\s+/i);
  return parts.length === 2 ? parts[index].trim() : "";
}

function readStart(record: Record<string, unknown>): string | null {
  for (const key of ["startTimeUTC", "startTimeUtc", "startsAt", "openDate", "advertisedStartTime", "startTime"]) {
    const value = record[key];
    if (typeof value === "string" && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString();
    if (typeof value === "number" && Number.isFinite(value)) {
      const ms = value < 1e11 ? value * 1000 : value;
      return new Date(ms).toISOString();
    }
  }
  return null;
}

function pairEvents(events: ListedEvent[], games: ScheduledGame[]): Array<{ game: MatchableGame; eventId: string }> {
  const pairs: Array<{ game: MatchableGame; eventId: string }> = [];
  for (const event of events) {
    const game = matchEventToGame(event, toMatchable(games));
    if (game) pairs.push({ game, eventId: event.id });
  }
  return pairs;
}

function toMatchable(games: ScheduledGame[]): MatchableGame[] {
  return games.map((game) => ({
    id: game.id,
    startTimeUtc: game.startTimeUtc,
    awayCommon: game.away.common,
    homeCommon: game.home.common,
  }));
}

type PointsBetListEvent = {
  key?: string;
  awayTeam?: string;
  homeTeam?: string;
  startsAt?: string;
};

type OddsApiEvent = {
  id?: string;
  commence_time?: string;
  home_team?: string;
  away_team?: string;
};
