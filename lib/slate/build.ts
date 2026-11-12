import { impliedProbability, edge } from "@/lib/odds/decimal";
import { quoteMatchesPlayer } from "@/lib/odds/names";
import { fetchAllOdds } from "@/lib/odds/providers";
import type { ProviderResult } from "@/lib/odds/types";
import { currentStat, gradeLeg, gradeParlay, hitCount, isFinalState, isLiveState } from "@/lib/grading/grade";
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
import { combinedDecimalOdds, combinedModelProbability, selectParlay } from "@/lib/parlay/select";
import { pickStarter, teamGoalieFactor, type StarterCandidate } from "@/lib/slate/starter";
import { getStore } from "@/lib/storage";
import { round } from "@/lib/format";
import { formatKickoff, formatSlateDay, gameClockLabel, melbourneToday, previousDate } from "@/lib/time";
import type { Leg, Slate, SlateGame, ScheduledGame } from "@/lib/types";
import type { LogGame } from "@/lib/model/rates";

export async function buildDate(date: string, options?: { force?: boolean }): Promise<Slate | null> {
  const schedule = await fetchSchedule(date);
  if (!schedule.length) return null;
  const existing = await getStore().getSlate(date);
  const started = schedule.some((game) => isLiveState(game.gameState) || isFinalState(game.gameState));
  if (existing && started && !options?.force) {
    console.log(`[job] ${date} already started, keeping the saved board and refreshing results`);
    return applyProgress(existing);
  }
  console.log(`[job] building ${date} (${schedule.length} games)`);
  const slate = await computeSlate(date, schedule);
  await getStore().putSlate(slate);
  return applyProgress(slate);
}

async function computeSlate(date: string, schedule: ScheduledGame[]): Promise<Slate> {
  const season = schedule.find((game) => game.season)?.season || 20262027;
  const moneypuck = await loadMoneyPuck(season);
  const yesterday = previousDate(date);
  const yesterdayTeams = await teamsOn(yesterday);
  const teams = [...new Set(schedule.flatMap((game) => [game.away.abbrev, game.home.abbrev]))];
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

  const odds = await fetchAllOdds(schedule);
  for (const result of odds) {
    const detail = result.skipped ? "skipped" : result.ok ? `${result.quotes.length} prices` : result.error;
    console.log(`[job] odds ${result.id}: ${detail}`);
  }
  attachPrices(legs, odds, rosters);

  const selection = selectParlay(
    legs.map((leg) => ({
      id: leg.id,
      gameId: leg.gameId,
      modelProb: leg.modelProb,
      decimalOdds: leg.decimalOdds,
      edge: leg.edge,
    })),
  );
  const chosen = (selection.legIds ?? [])
    .map((id) => legs.find((leg) => leg.id === id))
    .filter((leg): leg is Leg => Boolean(leg));
  const parlay =
    chosen.length === 3
      ? {
          legIds: chosen.map((leg) => leg.id),
          decimalOdds: round(combinedDecimalOdds(chosen.map((leg) => leg.decimalOdds ?? 0)), 4),
          modelProb: round(combinedModelProbability(chosen.map((leg) => leg.modelProb))),
          impliedProb: 0,
          edge: 0,
          status: "ALIVE" as const,
          hitCount: 0,
        }
      : null;
  if (parlay) {
    const implied = impliedProbability(parlay.decimalOdds) ?? 0;
    parlay.impliedProb = round(implied);
    parlay.edge = round(parlay.modelProb - implied);
  }

  const starts = schedule.map((game) => game.startTimeUtc).sort();
  const priced = legs.filter((leg) => leg.decimalOdds != null).length;
  return {
    slateDate: date,
    season,
    builtAt: new Date().toISOString(),
    gradedAt: null,
    melbourneLabel: formatSlateDay(starts[0]),
    firstPuck: formatKickoff(starts[0]),
    games: schedule.map(toSlateGame),
    legs,
    parlay,
    parlayNote: parlay ? selection.note : `${selection.note} ${priced} of ${legs.length} modeled legs had a posted price.`,
    modelNote: useMoneyPuckSeason
      ? "Season goal rates blend actual goals with MoneyPuck expected goals, then blend with the recent NHL game log. Opponent shots allowed and goalie quality are MoneyPuck season totals."
      : "This date is already in the past, so player rates use only NHL game logs from before the slate. Opponent shots and goalie quality still come from the current MoneyPuck file, which includes later games.",
    oddsReport: odds.map((result) => ({
      id: result.id,
      ok: result.ok,
      skipped: result.skipped,
      error: result.error,
      httpStatus: result.httpStatus,
      quotes: result.quotes.length,
    })),
  };
}

function attachPrices(legs: Leg[], results: ProviderResult[], rosters: Map<string, RosterPlayer[]>): void {
  const namesByGame = new Map<number, string[]>();
  for (const leg of legs) {
    const names = namesByGame.get(leg.gameId) ?? [];
    if (!names.includes(leg.playerName)) names.push(leg.playerName);
    namesByGame.set(leg.gameId, names);
  }
  for (const roster of rosters.values()) {
    for (const player of roster) {
      for (const leg of legs) {
        if (leg.teamAbbrev !== player.team) continue;
        const names = namesByGame.get(leg.gameId);
        if (names && !names.includes(player.name)) names.push(player.name);
      }
    }
  }

  for (const leg of legs) {
    const names = namesByGame.get(leg.gameId) ?? [leg.playerName];
    for (const result of results) {
      const quote = result.quotes.find(
        (item) =>
          item.gameId === leg.gameId &&
          item.market === leg.market &&
          quoteMatchesPlayer(item.playerName, leg.playerName, names),
      );
      if (!quote) continue;
      const implied = impliedProbability(quote.decimalOdds);
      const legEdge = edge(leg.modelProb, quote.decimalOdds);
      if (implied == null || legEdge == null) continue;
      leg.decimalOdds = round(quote.decimalOdds, 4);
      leg.impliedProb = round(implied);
      leg.edge = round(legEdge);
      leg.priceSource = quote.source;
      break;
    }
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
