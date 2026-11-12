import { getText } from "@/lib/http";
import { num, parseCsv } from "@/lib/moneypuck/csv";
import { shotsAgainstPer60 } from "@/lib/model/adjust";
import { getStore } from "@/lib/storage";

const HOURS_18 = 18 * 60 * 60 * 1000;

export type MpSkater = {
  playerId: number;
  name: string;
  team: string;
  position: string;
  games: number;
  icetime: number;
  goals: number;
  points: number;
  shots: number;
  xGoals: number;
};

export type MpGoalie = {
  playerId: number;
  name: string;
  team: string;
  games: number;
  icetime: number;
  shotsAgainst: number;
  goalsAgainst: number;
  xGoals: number;
};

export type MpTeam = {
  team: string;
  icetime: number;
  shotsAgainst: number;
  sa60: number | null;
};

export type MoneyPuckData = {
  year: number;
  skaters: Map<number, MpSkater>;
  goaliesByTeam: Map<string, MpGoalie[]>;
  teams: Map<string, MpTeam>;
  leagueSa60: number | null;
};

export async function loadMoneyPuck(season: number): Promise<MoneyPuckData> {
  const year = Math.floor(season / 10000) || new Date().getUTCFullYear();
  const resolved = await resolveYear(year);
  const [skaterText, goalieText, teamText] = await Promise.all([
    cachedCsv("skaters", resolved),
    cachedCsv("goalies", resolved),
    cachedCsv("teams", resolved),
  ]);
  const skaters = indexSkaters(skaterText);
  const goaliesByTeam = indexGoalies(goalieText);
  const teams = indexTeams(teamText);
  let shots = 0;
  let seconds = 0;
  for (const team of teams.values()) {
    shots += team.shotsAgainst;
    seconds += team.icetime;
  }
  return {
    year: resolved,
    skaters,
    goaliesByTeam,
    teams,
    leagueSa60: shotsAgainstPer60(shots, seconds),
  };
}

async function resolveYear(year: number): Promise<number> {
  if (await fresh(cacheKey(year, "teams"))) return year;
  const primary = await fetchCsv(year, "teams");
  if (primary.ok) {
    await getStore().putCache(cacheKey(year, "teams"), primary.text, new Date().toISOString());
    return year;
  }
  if (await fresh(cacheKey(year - 1, "teams"))) return year - 1;
  const fallback = await fetchCsv(year - 1, "teams");
  if (fallback.ok) {
    await getStore().putCache(cacheKey(year - 1, "teams"), fallback.text, new Date().toISOString());
    return year - 1;
  }
  throw new Error(`MoneyPuck season files were not available for ${year} or ${year - 1} (HTTP ${primary.status}).`);
}

async function fresh(key: string): Promise<boolean> {
  const hit = await getStore().getCache(key);
  return Boolean(hit && Date.now() - Date.parse(hit.fetchedAt) < HOURS_18);
}

async function cachedCsv(kind: "skaters" | "goalies" | "teams", year: number): Promise<string> {
  const key = cacheKey(year, kind);
  const hit = await getStore().getCache(key);
  if (hit && Date.now() - Date.parse(hit.fetchedAt) < HOURS_18) return hit.body;
  const response = await fetchCsv(year, kind);
  if (!response.ok) throw new Error(`MoneyPuck ${kind} ${year} returned HTTP ${response.status}`);
  await getStore().putCache(key, response.text, new Date().toISOString());
  return response.text;
}

function cacheKey(year: number, kind: string): string {
  return `moneypuck:${year}:${kind}`;
}

async function fetchCsv(year: number, kind: string): Promise<{ ok: boolean; status: number; text: string }> {
  const url = `https://moneypuck.com/moneypuck/playerData/seasonSummary/${year}/regular/${kind}.csv`;
  return getText(url, { accept: "text/csv, text/plain, */*", timeoutMs: 45000 });
}

function indexSkaters(text: string): Map<number, MpSkater> {
  const map = new Map<number, MpSkater>();
  for (const row of parseCsv(text)) {
    if (row.situation !== "all") continue;
    const playerId = num(row.playerId);
    if (!playerId) continue;
    const next: MpSkater = {
      playerId,
      name: row.name ?? "",
      team: row.team ?? "",
      position: row.position ?? "",
      games: num(row.games_played),
      icetime: num(row.icetime),
      goals: num(row.I_F_goals),
      points: num(row.I_F_points),
      shots: num(row.I_F_shotsOnGoal),
      xGoals: num(row.I_F_xGoals),
    };
    const current = map.get(playerId);
    if (!current) {
      map.set(playerId, next);
      continue;
    }
    current.games += next.games;
    current.icetime += next.icetime;
    current.goals += next.goals;
    current.points += next.points;
    current.shots += next.shots;
    current.xGoals += next.xGoals;
    if (next.icetime > 0) current.team = next.team;
  }
  return map;
}

function indexGoalies(text: string): Map<string, MpGoalie[]> {
  const byId = new Map<number, MpGoalie>();
  for (const row of parseCsv(text)) {
    if (row.situation !== "all") continue;
    const playerId = num(row.playerId);
    if (!playerId) continue;
    const next: MpGoalie = {
      playerId,
      name: row.name ?? "",
      team: row.team ?? "",
      games: num(row.games_played),
      icetime: num(row.icetime),
      shotsAgainst: num(row.ongoal),
      goalsAgainst: num(row.goals),
      xGoals: num(row.xGoals),
    };
    const current = byId.get(playerId);
    if (!current) {
      byId.set(playerId, next);
      continue;
    }
    current.games += next.games;
    current.icetime += next.icetime;
    current.shotsAgainst += next.shotsAgainst;
    current.goalsAgainst += next.goalsAgainst;
    current.xGoals += next.xGoals;
  }
  const byTeam = new Map<string, MpGoalie[]>();
  for (const goalie of byId.values()) {
    const list = byTeam.get(goalie.team) ?? [];
    list.push(goalie);
    byTeam.set(goalie.team, list);
  }
  return byTeam;
}

function indexTeams(text: string): Map<string, MpTeam> {
  const map = new Map<string, MpTeam>();
  for (const row of parseCsv(text)) {
    if (row.situation !== "all") continue;
    const team = row.team;
    if (!team) continue;
    const icetime = num(row.iceTime);
    const shotsAgainst = num(row.shotsOnGoalAgainst);
    map.set(team, {
      team,
      icetime,
      shotsAgainst,
      sa60: shotsAgainstPer60(shotsAgainst, icetime),
    });
  }
  return map;
}
