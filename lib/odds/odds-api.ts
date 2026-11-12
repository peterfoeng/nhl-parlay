import { mapPool } from "@/lib/http";
import type { MarketId } from "@/lib/model/constants";
import { toDecimalOdds } from "@/lib/odds/decimal";
import { matchEventToGame } from "@/lib/odds/match";
import type { PriceQuote, ProviderResult } from "@/lib/odds/types";
import { getStore } from "@/lib/storage";
import type { ScheduledGame } from "@/lib/types";

const API = "https://api.the-odds-api.com/v4";
const SPORT = "icehockey_nhl";
const DEFAULT_MARKETS = ["player_goal_scorer_anytime", "player_points", "player_shots_on_goal"];
/**
 * NHL player props are documented for US bookmakers. The AU feed (Sportsbet, TAB,
 * PointsBet AU) does not carry these markets, so one US region is the coverage
 * that still costs a single region multiplier.
 */
const DEFAULT_REGIONS = ["us"];
const EMPTY_CACHE_MS = 20 * 60 * 1000;

const MARKET_KIND: Record<string, "anytime_goal" | "points" | "shots"> = {
  player_goal_scorer_anytime: "anytime_goal",
  player_points: "points",
  player_points_alternate: "points",
  player_shots_on_goal: "shots",
  player_shots_on_goal_alternate: "shots",
};

export type OddsApiOutcome = {
  name?: string;
  description?: string;
  price?: number;
  point?: number;
};

export type OddsApiMarket = {
  key?: string;
  outcomes?: OddsApiOutcome[];
};

export type OddsApiBookmaker = {
  key?: string;
  markets?: OddsApiMarket[];
};

export type OddsApiEvent = {
  id?: string;
  commence_time?: string;
  home_team?: string;
  away_team?: string;
};

type OddsSettings = {
  markets: string[];
  regions: string[];
  cacheMs: number;
};

type StoredResponse = {
  status: number;
  body: string;
  headers: Record<string, string>;
};

type OddsHttp = {
  ok: boolean;
  status: number;
  body: string;
  requestsRemaining: number | null;
  creditsLast: number | null;
  fromCache: boolean;
};

/** Markets, region, and cache window. Defaults are one US region and the three player markets. */
export function oddsApiSettings(env: Record<string, string | undefined> = process.env): OddsSettings {
  return {
    markets: csv(env.ODDS_API_MARKETS, DEFAULT_MARKETS),
    regions: csv(env.ODDS_API_REGIONS, DEFAULT_REGIONS),
    cacheMs: hours(env.ODDS_API_CACHE_HOURS, 6),
  };
}

/** Dynamic lookup so a bundler cannot inline a build-time empty value. */
export function readOddsApiKey(env: Record<string, string | undefined> = process.env): string {
  const value = env["ODDS_API_KEY"];
  return typeof value === "string" ? value.trim() : "";
}

/** Event-odds cost is markets × regions. The events list itself is free. */
export function oddsApiCreditCost(settings: Pick<OddsSettings, "markets" | "regions">): number {
  return settings.markets.length * settings.regions.length;
}

export function cleanOddsPlayerName(name: string): string {
  const withoutTeam = name.replace(/\s*\([^)]*\)\s*$/u, "").replace(/\s+/g, " ").trim();
  const comma = withoutTeam.match(/^([^,]+),\s*(.+)$/u);
  if (!comma) return withoutTeam;
  return `${comma[2]} ${comma[1]}`.replace(/\s+/g, " ").trim();
}

/** The Odds API event-odds payload. Bookmaker key is kept on the source string. */
export function quotesFromOddsApi(gameId: number, bookmakers: OddsApiBookmaker[]): PriceQuote[] {
  const quotes: PriceQuote[] = [];
  for (const book of bookmakers) {
    const bookKey = book.key || "book";
    for (const market of book.markets ?? []) {
      const kind = market.key ? MARKET_KIND[market.key] : undefined;
      if (!kind) continue;
      for (const outcome of market.outcomes ?? []) {
        if (outcome.price == null) continue;
        const decimal = toDecimalOdds(outcome.price);
        if (decimal == null || !(decimal > 1)) continue;
        const side = (outcome.name ?? "").toLowerCase();
        if (side === "under" || side === "no") continue;
        const raw = outcome.description || (side === "over" || side === "yes" ? "" : outcome.name) || "";
        const playerName = cleanOddsPlayerName(raw);
        if (!playerName || /^(over|under|yes|no)$/i.test(playerName)) continue;

        let marketId: MarketId | null = null;
        if (kind === "anytime_goal") marketId = "anytime_goal";
        if (kind === "points" && (outcome.point == null || lineIs(outcome.point, 0.5))) marketId = "anytime_point";
        if (kind === "shots") {
          if (lineIs(outcome.point, 1.5)) marketId = "sog_over_15";
          if (lineIs(outcome.point, 2.5)) marketId = "sog_over_25";
        }
        if (!marketId) continue;
        quotes.push({
          gameId,
          playerName,
          market: marketId,
          decimalOdds: decimal,
          source: `oddsapi:${bookKey}`,
        });
      }
    }
  }
  return quotes;
}

export async function fetchOddsApi(games: ScheduledGame[]): Promise<ProviderResult> {
  try {
    return await loadOddsApi(games);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The Odds API failed";
    return { id: "oddsapi", ok: false, error: redact(message), quotes: [] };
  }
}

async function loadOddsApi(games: ScheduledGame[]): Promise<ProviderResult> {
  const apiKey = readOddsApiKey();
  if (!apiKey) {
    return { id: "oddsapi", ok: false, skipped: true, error: "ODDS_API_KEY is not set.", quotes: [] };
  }
  if (!games.length) {
    return { id: "oddsapi", ok: true, quotes: [], error: "No games still to start; stored prices kept." };
  }

  const settings = oddsApiSettings();
  const markets = settings.markets.join(",");
  const regions = settings.regions.join(",");
  const eventsResponse = await cachedOddsGet(
    `oddsapi:v4:events:${SPORT}`,
    oddsUrl(`/sports/${SPORT}/events`, { apiKey, dateFormat: "iso" }),
    // The events list is free. Keep it shorter than priced odds so a newly posted game is seen.
    Math.min(settings.cacheMs, 30 * 60 * 1000),
  );
  if (!eventsResponse.ok) return failed(eventsResponse);

  let events: OddsApiEvent[];
  try {
    const parsed = JSON.parse(eventsResponse.body) as unknown;
    if (!Array.isArray(parsed)) throw new Error("not a list");
    events = parsed as OddsApiEvent[];
  } catch {
    return {
      id: "oddsapi",
      ok: false,
      httpStatus: eventsResponse.status,
      error: "The Odds API events payload was not a list.",
      quotes: [],
      ...usageFields(eventsResponse.requestsRemaining, eventsResponse.fromCache ? 0 : (eventsResponse.creditsLast ?? 0)),
    };
  }

  const matched = pairEvents(events, games);
  const fetched = await mapPool(matched, 3, async (item) => {
    const cacheKey = `oddsapi:v4:event:${item.eventId}:${regions}:${markets}:decimal`;
    const url = oddsUrl(`/sports/${SPORT}/events/${encodeURIComponent(item.eventId)}/odds`, {
      apiKey,
      regions,
      markets,
      oddsFormat: "decimal",
      dateFormat: "iso",
    });
    try {
      const response = await cachedOddsGet(cacheKey, url, settings.cacheMs);
      if (!response.ok) {
        return { quotes: [] as PriceQuote[], failed: true, response };
      }
      const body = JSON.parse(response.body) as { bookmakers?: OddsApiBookmaker[] };
      return { quotes: quotesFromOddsApi(item.gameId, body.bookmakers ?? []), failed: false, response };
    } catch (error) {
      const message = error instanceof Error ? error.message : "event odds failed";
      return {
        quotes: [] as PriceQuote[],
        failed: true,
        response: {
          ok: false,
          status: 0,
          body: message,
          requestsRemaining: null,
          creditsLast: null,
          fromCache: false,
        } satisfies OddsHttp,
      };
    }
  });

  const quotes = fetched.flatMap((item) => item.quotes);
  const failures = fetched.filter((item) => item.failed).length;
  let requestsRemaining: number | null = eventsResponse.fromCache ? null : eventsResponse.requestsRemaining;
  let sawNetwork = !eventsResponse.fromCache;
  let creditsUsed = eventsResponse.fromCache ? 0 : (eventsResponse.creditsLast ?? 0);
  let eventNetwork = 0;
  for (const item of fetched) {
    const remaining = item.response.requestsRemaining;
    if (remaining != null && (!item.response.fromCache || !sawNetwork)) {
      requestsRemaining = remaining;
    }
    if (!item.response.fromCache) {
      sawNetwork = true;
      eventNetwork += 1;
      creditsUsed += item.response.creditsLast ?? 0;
      if (remaining != null) requestsRemaining = remaining;
    }
  }

  const fromCache = matched.length > 0 && eventNetwork === 0;
  const error =
    failures > 0
      ? `${failures} of ${matched.length} event odds calls failed.`
      : matched.length === 0
        ? "No Odds API events matched this slate."
        : undefined;
  const allFailed = matched.length > 0 && failures === matched.length;
  return {
    id: "oddsapi",
    ok: !allFailed,
    httpStatus: allFailed ? fetched.find((item) => item.failed)?.response.status : undefined,
    error,
    quotes,
    fromCache: fromCache || undefined,
    ...usageFields(requestsRemaining, creditsUsed),
  };
}

function usageFields(requestsRemaining: number | null, creditsUsed: number): Pick<ProviderResult, "requestsRemaining" | "creditsUsed"> {
  return {
    ...(requestsRemaining == null ? {} : { requestsRemaining }),
    creditsUsed,
  };
}

function failed(response: OddsHttp): ProviderResult {
  return {
    id: "oddsapi",
    ok: false,
    httpStatus: response.status,
    error: `The Odds API HTTP ${response.status}: ${redact(response.body)}`,
    quotes: [],
    ...usageFields(response.requestsRemaining, response.fromCache ? 0 : (response.creditsLast ?? 0)),
  };
}

function pairEvents(events: OddsApiEvent[], games: ScheduledGame[]): Array<{ gameId: number; eventId: string }> {
  const matchable = games.map((game) => ({
    id: game.id,
    startTimeUtc: game.startTimeUtc,
    awayCommon: game.away.common,
    homeCommon: game.home.common,
  }));
  const used = new Set<number>();
  const pairs: Array<{ gameId: number; eventId: string }> = [];
  for (const event of events) {
    if (!event.id || !event.commence_time || !event.away_team || !event.home_team) continue;
    const game = matchEventToGame(
      { away: event.away_team, home: event.home_team, startsAt: event.commence_time },
      matchable,
    );
    if (!game || used.has(game.id)) continue;
    used.add(game.id);
    pairs.push({ gameId: game.id, eventId: event.id });
  }
  return pairs;
}

function oddsUrl(path: string, params: Record<string, string>): string {
  return `${API}${path}?${new URLSearchParams(params).toString()}`;
}

async function cachedOddsGet(cacheKey: string, url: string, successTtlMs: number): Promise<OddsHttp> {
  const store = getStore();
  const hit = await store.getCache(cacheKey);
  if (hit) {
    const stored = parseStored(hit.body);
    const age = Date.now() - Date.parse(hit.fetchedAt);
    if (stored && age >= 0 && age < ttlFor(stored, successTtlMs)) return toHttp(stored, true);
  }
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(20000),
    headers: { Accept: "application/json" },
  });
  const body = await response.text();
  const headers = {
    "x-requests-remaining": response.headers.get("x-requests-remaining") ?? "",
    "x-requests-used": response.headers.get("x-requests-used") ?? "",
    "x-requests-last": response.headers.get("x-requests-last") ?? "",
  };
  const stored: StoredResponse = { status: response.status, body, headers };
  if (response.ok) await store.putCache(cacheKey, JSON.stringify(stored), new Date().toISOString());
  return toHttp(stored, false);
}

function ttlFor(stored: StoredResponse, successTtlMs: number): number {
  if (stored.status !== 200) return 0;
  return hasPrices(stored.body) ? successTtlMs : Math.min(successTtlMs, EMPTY_CACHE_MS);
}

function hasPrices(body: string): boolean {
  try {
    const parsed = JSON.parse(body) as unknown;
    if (Array.isArray(parsed)) return parsed.length > 0;
    if (!parsed || typeof parsed !== "object") return false;
    const books = (parsed as { bookmakers?: OddsApiBookmaker[] }).bookmakers ?? [];
    return books.some((book) => (book.markets ?? []).some((market) => (market.outcomes ?? []).length > 0));
  } catch {
    return false;
  }
}

function parseStored(body: string): StoredResponse | null {
  try {
    const parsed = JSON.parse(body) as StoredResponse;
    if (typeof parsed?.body !== "string" || typeof parsed.status !== "number") return null;
    return { status: parsed.status, body: parsed.body, headers: parsed.headers ?? {} };
  } catch {
    return null;
  }
}

function toHttp(stored: StoredResponse, fromCache: boolean): OddsHttp {
  return {
    ok: stored.status >= 200 && stored.status < 300,
    status: stored.status,
    body: stored.body,
    requestsRemaining: headerNumber(stored.headers, "x-requests-remaining"),
    creditsLast: headerNumber(stored.headers, "x-requests-last"),
    fromCache,
  };
}

function headerNumber(headers: Record<string, string>, name: string): number | null {
  const raw = headers[name];
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function redact(text: string): string {
  const key = readOddsApiKey();
  let cleaned = text.replace(/apiKey=[^&\s"']+/gi, "apiKey=REDACTED");
  if (key) cleaned = cleaned.split(key).join("REDACTED");
  return cleaned.replace(/\s+/g, " ").slice(0, 180);
}

function lineIs(point: number | undefined, target: number): boolean {
  return typeof point === "number" && Number.isFinite(point) && Math.abs(point - target) < 0.001;
}

function csv(value: string | undefined, fallback: string[]): string[] {
  if (value == null || value.trim() === "") return [...fallback];
  const parsed = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return parsed.length ? parsed : [...fallback];
}

function hours(value: string | undefined, fallbackHours: number): number {
  if (value == null || value.trim() === "") return fallbackHours * 60 * 60 * 1000;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallbackHours * 60 * 60 * 1000;
  return parsed * 60 * 60 * 1000;
}
