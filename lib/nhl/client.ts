import { getText, mapPool } from "@/lib/http";
import type { LogGame } from "@/lib/model/rates";
import { getStore } from "@/lib/storage";
import type { BoxLine } from "@/lib/grading/grade";
import type { ScheduledGame, TeamSide } from "@/lib/types";

const NHL = "https://api-web.nhle.com";
const MINUTE = 60 * 1000;

export type RosterPlayer = {
  id: number;
  name: string;
  position: string;
  headshot: string;
  team: string;
};

export type ParsedBox = {
  id: number;
  gameState: string;
  period?: { number?: number; periodType?: string };
  clock?: { timeRemaining?: string; inIntermission?: boolean };
  players: Map<number, BoxLine>;
};

export async function fetchSchedule(date: string): Promise<ScheduledGame[]> {
  const text = await cached(`nhl:schedule:${date}`, MINUTE, () => nhlText(`${NHL}/v1/schedule/${date}`));
  const payload = JSON.parse(text) as { gameWeek?: Array<{ date?: string; games?: unknown[] }> };
  const day = (payload.gameWeek ?? []).find((entry) => entry.date === date);
  return (day?.games ?? []).map((game) => readScheduledGame(game, date)).filter((game): game is ScheduledGame => game != null);
}

export async function fetchRoster(team: string, season: number): Promise<RosterPlayer[]> {
  const text = await cached(`nhl:roster:${team}`, 12 * 60 * MINUTE, () => nhlText(`${NHL}/v1/roster/${team}/current`));
  const payload = JSON.parse(text) as Record<string, unknown>;
  const groups: Array<[string, string]> = [
    ["forwards", "F"],
    ["defensemen", "D"],
    ["goalies", "G"],
  ];
  const players: RosterPlayer[] = [];
  for (const [key, fallbackPosition] of groups) {
    const rows = Array.isArray(payload[key]) ? payload[key] : [];
    for (const row of rows) {
      const player = readRosterPlayer(row, team, season, fallbackPosition);
      if (player) players.push(player);
    }
  }
  return players;
}

export async function fetchGameLog(playerId: number): Promise<LogGame[]> {
  const text = await cached(
    `nhl:gamelog:${playerId}`,
    6 * 60 * MINUTE,
    () => nhlText(`${NHL}/v1/player/${playerId}/game-log/now`),
  );
  const payload = JSON.parse(text) as { gameLog?: unknown[] };
  const games = (payload.gameLog ?? []).map(readLogGame).filter((game): game is LogGame => game != null);
  games.sort((a, b) => b.gameDate.localeCompare(a.gameDate));
  return games;
}

export async function fetchBox(id: number, preferCache: boolean): Promise<ParsedBox> {
  const key = `nhl:box:${id}`;
  if (preferCache) {
    const hit = await getStore().getCache(key);
    if (hit) {
      const parsed = parseBox(id, hit.body);
      if (parsed && isFinal(parsed.gameState)) return parsed;
    }
  }
  const text = await nhlText(`${NHL}/v1/gamecenter/${id}/boxscore`);
  const parsed = parseBox(id, text);
  if (!parsed) throw new Error(`Box score ${id} could not be read`);
  if (isFinal(parsed.gameState)) {
    await getStore().putCache(key, text, new Date().toISOString());
  }
  return parsed;
}

export async function fetchGameLogs(playerIds: number[], onProgress?: (done: number, total: number) => void): Promise<Map<number, LogGame[]>> {
  const unique = [...new Set(playerIds)];
  const logs = new Map<number, LogGame[]>();
  let done = 0;
  await mapPool(unique, 8, async (playerId) => {
    try {
      logs.set(playerId, await fetchGameLog(playerId));
    } catch {
      logs.set(playerId, []);
    }
    done += 1;
    if (done % 40 === 0 || done === unique.length) onProgress?.(done, unique.length);
  });
  return logs;
}

async function cached(key: string, ttlMs: number, load: () => Promise<string>): Promise<string> {
  const store = getStore();
  const hit = await store.getCache(key);
  if (hit && Date.now() - Date.parse(hit.fetchedAt) < ttlMs) return hit.body;
  const body = await load();
  await store.putCache(key, body, new Date().toISOString());
  return body;
}

async function nhlText(url: string): Promise<string> {
  let last = "no response";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await getText(url);
    if (response.ok) return response.text;
    last = String(response.status);
    if (response.status === 404) break;
    await delay(250 * (attempt + 1));
  }
  throw new Error(`NHL request failed (${last}) for ${url.replace(NHL, "")}`);
}

function readScheduledGame(value: unknown, slateDate: string): ScheduledGame | null {
  if (!value || typeof value !== "object") return null;
  const game = value as Record<string, unknown>;
  const id = numberValue(game.id);
  const start = stringValue(game.startTimeUTC);
  if (id == null || !start) return null;
  const away = readSide(game.awayTeam);
  const home = readSide(game.homeTeam);
  if (!away || !home) return null;
  const period = readPeriod(game.periodDescriptor);
  const clock = readClock(game.clock);
  return {
    id,
    slateDate,
    season: numberValue(game.season) ?? 0,
    startTimeUtc: start,
    gameState: stringValue(game.gameState) ?? "FUT",
    away,
    home,
    period,
    clock,
  };
}

function readSide(value: unknown): TeamSide | null {
  if (!value || typeof value !== "object") return null;
  const team = value as Record<string, unknown>;
  const abbrev = stringValue(team.abbrev);
  if (!abbrev) return null;
  return {
    abbrev,
    common: nestedName(team.commonName) || abbrev,
    place: nestedName(team.placeName) || abbrev,
    logo: stringValue(team.logo) ?? "",
  };
}

function readRosterPlayer(value: unknown, team: string, season: number, fallbackPosition: string): RosterPlayer | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = numberValue(row.id);
  const first = nestedName(row.firstName);
  const last = nestedName(row.lastName);
  if (id == null || !last) return null;
  const position = stringValue(row.positionCode) || fallbackPosition;
  const headshot =
    stringValue(row.headshot) ||
    `https://assets.nhle.com/mugs/nhl/${season}/${team}/${id}.png`;
  return { id, name: `${first} ${last}`.trim(), position, headshot, team };
}

function readLogGame(value: unknown): LogGame | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const gameDate = stringValue(row.gameDate);
  if (!gameDate) return null;
  return {
    gameDate,
    goals: numberValue(row.goals) ?? 0,
    assists: numberValue(row.assists) ?? 0,
    shots: numberValue(row.shots) ?? 0,
    toiSeconds: parseToi(row.toi),
  };
}

function parseBox(id: number, text: string): ParsedBox | null {
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
  const players = new Map<number, BoxLine>();
  const byGame = payload.playerByGameStats;
  if (byGame && typeof byGame === "object") {
    for (const side of ["awayTeam", "homeTeam"] as const) {
      const team = (byGame as Record<string, unknown>)[side];
      if (!team || typeof team !== "object") continue;
      for (const group of ["forwards", "defense", "goalies"] as const) {
        const rows = (team as Record<string, unknown>)[group];
        if (!Array.isArray(rows)) continue;
        for (const row of rows) {
          const line = readBoxLine(row);
          if (line) players.set(line.id, line.stats);
        }
      }
    }
  }
  return {
    id,
    gameState: stringValue(payload.gameState) ?? "FUT",
    period: readPeriod(payload.periodDescriptor),
    clock: readClock(payload.clock),
    players,
  };
}

function readBoxLine(value: unknown): { id: number; stats: BoxLine } | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = numberValue(row.playerId);
  if (id == null) return null;
  const goals = numberValue(row.goals) ?? 0;
  const assists = numberValue(row.assists) ?? 0;
  return {
    id,
    stats: {
      goals,
      assists,
      points: numberValue(row.points) ?? goals + assists,
      shots: numberValue(row.sog) ?? numberValue(row.shots) ?? 0,
      toiSeconds: parseToi(row.toi),
    },
  };
}

export function parseToi(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return 0;
  const match = /^(\d+):(\d{2})$/.exec(value.trim());
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

function readPeriod(value: unknown): { number?: number; periodType?: string } | undefined {
  if (!value || typeof value !== "object") return undefined;
  const period = value as Record<string, unknown>;
  return { number: numberValue(period.number) ?? undefined, periodType: stringValue(period.periodType) };
}

function readClock(value: unknown): { timeRemaining?: string; inIntermission?: boolean } | undefined {
  if (!value || typeof value !== "object") return undefined;
  const clock = value as Record<string, unknown>;
  return {
    timeRemaining: stringValue(clock.timeRemaining),
    inIntermission: Boolean(clock.inIntermission),
  };
}

function nestedName(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  return stringValue(record.default) ?? "";
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function isFinal(state: string): boolean {
  return state === "OFF" || state === "FINAL" || state === "OFFICIAL" || state === "OVER";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
