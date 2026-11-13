import { fetchAllOdds } from "@/lib/odds/providers";
import type { ProviderResult } from "@/lib/odds/types";
import { currentStat, gradeLeg, gradeParlay, hitCount, isFinalState } from "@/lib/grading/grade";
import { MODEL } from "@/lib/model/constants";
import { opponentShotFactor } from "@/lib/model/adjust";
import { projectPlayer } from "@/lib/model/player";
import { loadMoneyPuck, type MoneyPuckData } from "@/lib/moneypuck/load";
import {
  fetchBox,
  fetchGameLogs,
  fetchRoster,
  fetchSchedule,
  type RosterPlayer,
} from "@/lib/nhl/client";
import {
  applyProviderPrices,
  gameStillToPrice,
  restorePrices,
  repriceOpenLegs,
  syncParlay,
  toOddsReport,
} from "@/lib/slate/prices";
import { pickStarter, teamGoalieFactor, type StarterCandidate } from "@/lib/slate/starter";
import { syncTrackedGrades } from "@/lib/multis/persist";
import { getStore } from "@/lib/storage";
import { round } from "@/lib/format";
import { formatKickoff, formatSlateDay, gameClockLabel, melbourneToday, previousDate } from "@/lib/time";
import type { Leg, Slate, SlateGame, ScheduledGame } from "@/lib/types";
import type { LogGame } from "@/lib/model/rates";

export async function buildDate(date: string, options?: { force?: boolean }): Promise<Slate | null> {
  const schedule = await fetchSchedule(date);
  if (!schedule.length) return null;
  const existing = await getStore().getSlate(date);
  const open = schedule.filter((game) => gameStillToPrice(game));
  if (existing && open.length !== schedule.length && !options?.force) {
    console.log(
      `[job] ${date}: ${open.length} of ${schedule.length} games still to start; refreshing those prices and keeping the rest`,
    );
    const refreshed = await refreshSavedOdds(existing, schedule, open);
    return applyProgress(refreshed);
  }
  console.log(`[job] building ${date} (${schedule.length} games)`);
  const slate = await computeSlate(date, schedule, existing);
  await getStore().putSlate(slate);
  return applyProgress(slate);
}

async function refreshSavedOdds(existing: Slate, schedule: ScheduledGame[], open: ScheduledGame[]): Promise<Slate> {
  const next = structuredClone(existing);
  adoptSchedule(next, schedule);
  const odds = await fetchAllOdds(open);
  logOdds(odds);
  if (open.length && odds.some((result) => result.ok)) {
    const teams = [...new Set(open.flatMap((game) => [game.away.abbrev, game.home.abbrev]))];
    const rosters = await loadRosters(teams, next.season);
    const openIds = new Set(open.map((game) => game.id));
    repriceOpenLegs(next.legs, openIds, odds, rosters);
    syncParlay(next, openIds);
  }
  next.oddsReport = toOddsReport(odds);
  return next;
}

async function computeSlate(date: string, schedule: ScheduledGame[], existing: Slate | null): Promise<Slate> {
  const season = schedule.find((game) => game.season)?.season || 20262027;
  const moneypuck = await loadMoneyPuck(season);
  const yesterday = previousDate(date);
  const yesterdayTeams = await teamsOn(yesterday);
  const teams = [...new Set(schedule.flatMap((game) => [game.away.abbrev, game.home.abbrev]))];
  const rosters = await loadRosters(teams, season);

  const candidates = pickCandidates(rosters, moneypuck);
  const goalieIds = teams.flatMap((team) => (rosters.get(team) ?? []).filter((player) => player.position === "G").map((player) => player.id));
  const ids = [...candidates.map((candidate) => candidate.player.id), ...goalieIds];
  console.log(`[job] fetching game logs for ${new Set(ids).size} players`);
  const logs = await fetchGameLogs(ids, (done, total) => {
    console.log(`[job] game logs ${done}/${total}`);
  });

  const useMoneyPuckSeason = date >= melbourneToday();
  const legs: Leg[] = [];
  for (const game of schedule) {
    for (const side of ["away", "home"] as const) {
      const team = side === "away" ? game.away : game.home;
      const opponent = side === "away" ? game.home : game.away;
      const teamCandidates = candidates.filter((candidate) => candidate.player.team === team.abbrev);
      const starterPool = goaliePool(opponent.abbrev, rosters.get(opponent.abbrev) ?? [], moneypuck, logs, date);
      const pick = pickStarter(starterPool, yesterdayTeams.has(opponent.abbrev), yesterday);
      const teamFactor = teamGoalieFactor(starterPool);
      const goalieFactor = pick.factor ?? teamFactor ?? 1;
      const goalieReason =
        pick.factor == null && teamFactor != null
          ? `${pick.reason} Individual save quality was missing, so the team average is used.`
          : pick.reason;
      const oppFactor = opponentShotFactor(moneypuck.teams.get(opponent.abbrev)?.sa60 ?? null, moneypuck.leagueSa60);

      for (const candidate of teamCandidates) {
        const prior = (logs.get(candidate.player.id) ?? []).filter((row) => row.gameDate < date);
        if (prior.length < MODEL.minGames) continue;
        const skater = candidate.skater;
        const markets = projectPlayer({
          priorGames: prior,
          season: {
            goals: skater.goals,
            assists: Math.max(0, skater.points - skater.goals),
            shots: skater.shots,
            toiSeconds: skater.icetime,
            xGoals: skater.xGoals,
          },
          seasonGames: skater.games,
          useMoneyPuckSeason,
          oppFactor,
          goalieFactor,
          goalieReason,
        });
        if (!markets) continue;
        for (const market of markets) {
          const slateGame = toSlateGame(game);
          legs.push({
            id: `${date}:${candidate.player.id}:${market.market}`,
            slateDate: date,
            playerId: candidate.player.id,
            playerName: candidate.player.name,
            teamAbbrev: team.abbrev,
            opponentAbbrev: opponent.abbrev,
            gameId: game.id,
            matchup: `${team.abbrev} vs ${opponent.abbrev}`,
            market: market.market,
            modelProb: round(market.probability),
            lambda: round(market.lambda),
            target: market.target,
            explanation: market.explanation,
            decimalOdds: null,
            impliedProb: null,
            edge: null,
            priceSource: null,
            headshot: candidate.player.headshot,
            teamLogo: team.logo,
            status: "pending",
            current: 0,
            gameState: slateGame.gameState,
            clockLabel: slateGame.clockLabel,
            startTimeUtc: game.startTimeUtc,
          });
        }
      }
    }
  }

  const open = schedule.filter((game) => gameStillToPrice(game));
  const openIds = new Set(open.map((game) => game.id));
  const startedIds = new Set(schedule.filter((game) => !openIds.has(game.id)).map((game) => game.id));
  if (existing) restorePrices(legs, existing.legs, startedIds);
  const odds = await fetchAllOdds(open);
  logOdds(odds);
  if (odds.some((result) => result.ok)) {
    applyProviderPrices(
      legs.filter((leg) => openIds.has(leg.gameId)),
      odds,
      rosters,
    );
  } else if (existing) {
    restorePrices(legs, existing.legs, openIds);
  }

  const starts = schedule.map((game) => game.startTimeUtc).sort();
  const priced = legs.filter((leg) => leg.decimalOdds != null).length;
  const slate: Slate = {
    slateDate: date,
    season,
    builtAt: new Date().toISOString(),
    gradedAt: null,
    melbourneLabel: formatSlateDay(starts[0]),
    firstPuck: formatKickoff(starts[0]),
    games: schedule.map(toSlateGame),
    legs,
    parlay: null,
    parlayNote: "",
    modelNote: useMoneyPuckSeason
      ? "Season goal rates blend actual goals with MoneyPuck expected goals, then blend with the recent NHL game log. Opponent shots allowed and goalie quality are MoneyPuck season totals."
      : "This date is already in the past, so player rates use only NHL game logs from before the slate. Opponent shots and goalie quality still come from the current MoneyPuck file, which includes later games.",
    oddsReport: toOddsReport(odds),
  };
  syncParlay(slate, new Set(schedule.map((game) => game.id)), ` ${priced} of ${legs.length} modeled legs had a posted price.`);
  return slate;
}

async function loadRosters(teams: string[], season: number): Promise<Map<string, RosterPlayer[]>> {
  const rosters = new Map<string, RosterPlayer[]>();
  await Promise.all(
    teams.map(async (team) => {
      try {
        rosters.set(team, await fetchRoster(team, season));
      } catch (error) {
        console.log(`[job] roster ${team} skipped: ${error instanceof Error ? error.message : error}`);
        rosters.set(team, []);
      }
    }),
  );
  return rosters;
}

function adoptSchedule(slate: Slate, schedule: ScheduledGame[]): void {
  for (const scheduled of schedule) {
    const game = slate.games.find((item) => item.id === scheduled.id);
    if (!game) continue;
    const fresh = toSlateGame(scheduled);
    game.gameState = fresh.gameState;
    game.clockLabel = fresh.clockLabel;
    game.periodNumber = fresh.periodNumber;
    game.periodType = fresh.periodType;
    game.startTimeUtc = fresh.startTimeUtc;
  }
  for (const leg of slate.legs) {
    const game = slate.games.find((item) => item.id === leg.gameId);
    if (!game) continue;
    leg.gameState = game.gameState;
    leg.clockLabel = game.clockLabel;
    leg.startTimeUtc = game.startTimeUtc;
  }
}

function logOdds(results: ProviderResult[]): void {
  for (const result of results) {
    const detail = result.skipped ? "skipped" : result.ok ? `${result.quotes.length} prices` : result.error;
    const usage = [
      result.creditsUsed != null ? `spent ${result.creditsUsed}` : "",
      result.requestsRemaining != null ? `remaining ${result.requestsRemaining}` : "",
      result.fromCache ? "cached" : "",
    ].filter(Boolean);
    console.log(`[job] odds ${result.id}: ${detail}${usage.length ? ` (${usage.join(", ")})` : ""}`);
  }
}

function pickCandidates(rosters: Map<string, RosterPlayer[]>, moneypuck: MoneyPuckData) {
  const chosen: Array<{ player: RosterPlayer; skater: MoneyPuckData["skaters"] extends Map<number, infer T> ? T : never }> = [];
  for (const roster of rosters.values()) {
    const ranked = roster
      .filter((player) => player.position !== "G")
      .map((player) => ({ player, skater: moneypuck.skaters.get(player.id) }))
      .filter((row): row is { player: RosterPlayer; skater: NonNullable<typeof row.skater> } => {
        if (!row.skater || row.skater.games < MODEL.minGames) return false;
        return row.skater.icetime / row.skater.games / 60 >= MODEL.minAvgToiMinutes;
      })
      .sort((a, b) => b.skater.icetime - a.skater.icetime)
      .slice(0, MODEL.skatersPerTeam);
    chosen.push(...ranked);
  }
  return chosen;
}

function goaliePool(
  team: string,
  roster: RosterPlayer[],
  moneypuck: MoneyPuckData,
  logs: Map<number, LogGame[]>,
  slateDate: string,
): StarterCandidate[] {
  const mpGoalies = moneypuck.goaliesByTeam.get(team) ?? [];
  const ids = new Set<number>([
    ...roster.filter((player) => player.position === "G").map((player) => player.id),
    ...mpGoalies.map((goalie) => goalie.playerId),
  ]);
  return [...ids].map((id) => {
    const mpGoalie = mpGoalies.find((goalie) => goalie.playerId === id);
    const person = roster.find((player) => player.id === id);
    const prior = (logs.get(id) ?? []).filter((game) => game.gameDate < slateDate && game.toiSeconds > 0);
    const last = prior[0];
    return {
      playerId: id,
      name: person?.name || mpGoalie?.name || `Goalie ${id}`,
      games: mpGoalie?.games ?? prior.length,
      lastDate: last?.gameDate ?? null,
      lastToiMinutes: last ? last.toiSeconds / 60 : 0,
      goalsAgainst: mpGoalie?.goalsAgainst ?? null,
      xGoalsAgainst: mpGoalie && mpGoalie.xGoals > 0 ? mpGoalie.xGoals : null,
    };
  });
}

async function teamsOn(date: string): Promise<Set<string>> {
  try {
    const games = await fetchSchedule(date);
    return new Set(games.flatMap((game) => [game.away.abbrev, game.home.abbrev]));
  } catch {
    return new Set();
  }
}

export function toSlateGame(game: ScheduledGame): SlateGame {
  return {
    id: game.id,
    startTimeUtc: game.startTimeUtc,
    gameState: game.gameState,
    awayAbbrev: game.away.abbrev,
    homeAbbrev: game.home.abbrev,
    awayCommon: game.away.common,
    homeCommon: game.home.common,
    awayPlace: game.away.place,
    homePlace: game.home.place,
    awayLogo: game.away.logo,
    homeLogo: game.home.logo,
    clockLabel: gameClockLabel({
      gameState: game.gameState,
      startTimeUtc: game.startTimeUtc,
      period: game.period,
      clock: game.clock,
    }),
    periodNumber: game.period?.number,
    periodType: game.period?.periodType,
  };
}

export async function applyProgress(slate: Slate): Promise<Slate> {
  const next: Slate = structuredClone(slate);
  const now = Date.now();
  await Promise.all(
    next.games.map(async (game) => {
      const gameLegs = next.legs.filter((leg) => leg.gameId === game.id);
      if (!gameNeedsBox(game, gameLegs, now)) {
        game.clockLabel = gameClockLabel({ gameState: game.gameState, startTimeUtc: game.startTimeUtc });
        return;
      }
      try {
        const box = await fetchBox(game.id, isFinalState(game.gameState));
        game.gameState = box.gameState;
        game.periodNumber = box.period?.number;
        game.periodType = box.period?.periodType;
        game.clockLabel = gameClockLabel({
          gameState: box.gameState,
          startTimeUtc: game.startTimeUtc,
          period: box.period,
          clock: box.clock,
        });
        for (const leg of gameLegs) {
          const line = box.players.get(leg.playerId) ?? null;
          leg.current = currentStat(leg.market, line);
          leg.gameState = game.gameState;
          leg.clockLabel = game.clockLabel;
          leg.status = gradeLeg({
            current: leg.current,
            target: leg.target,
            gameFinal: isFinalState(game.gameState),
            inBoxscore: line != null,
            toiSeconds: line?.toiSeconds ?? 0,
          });
        }
      } catch (error) {
        console.log(`[job] box ${game.id} skipped: ${error instanceof Error ? error.message : error}`);
      }
    }),
  );

  for (const leg of next.legs) {
    const game = next.games.find((item) => item.id === leg.gameId);
    if (!game) continue;
    leg.gameState = game.gameState;
    leg.clockLabel = game.clockLabel;
  }

  if (next.parlay) {
    const statuses = next.parlay.legIds.map((id) => next.legs.find((leg) => leg.id === id)?.status ?? "pending");
    next.parlay.status = gradeParlay(statuses);
    next.parlay.hitCount = hitCount(statuses);
  }
  next.gradedAt = new Date().toISOString();
  await getStore().putSlate(next);
  try {
    await syncTrackedGrades([next]);
  } catch (error) {
    console.log(`[multis] grade skipped: ${error instanceof Error ? error.message : error}`);
  }
  return next;
}

export function gameNeedsBox(game: SlateGame, legs: Leg[], now = Date.now()): boolean {
  const pending = legs.some((leg) => leg.status === "pending");
  if (isFinalState(game.gameState)) return pending;
  const start = Date.parse(game.startTimeUtc);
  if (game.gameState === "FUT" && start - now > 15 * 60 * 1000) return false;
  return true;
}

export function shouldPoll(slate: Slate, now = Date.now()): boolean {
  return slate.games.some((game) => {
    if (isFinalState(game.gameState)) return false;
    const start = Date.parse(game.startTimeUtc);
    return now >= start - 30 * 60 * 1000 && now <= start + 6 * 60 * 60 * 1000;
  });
}
