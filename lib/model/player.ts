import { expectedCounts } from "@/lib/model/adjust";
import {
  MARKET_LABEL,
  MARKET_TARGET,
  MODEL,
  type MarketId,
} from "@/lib/model/constants";
import { poissonAtLeast } from "@/lib/model/poisson";
import { projectToiMinutes } from "@/lib/model/project";
import {
  aggregate,
  averageToiMinutes,
  blendRate,
  goalRatePer60,
  per60,
  recentShare,
  weightedRecent,
  type Counting,
  type LogGame,
} from "@/lib/model/rates";

export type MarketProjection = {
  market: MarketId;
  probability: number;
  lambda: number;
  target: number;
  explanation: string;
};

export type PlayerProjectionInput = {
  /** Most recent first. The full prior log, not only the last 10. */
  priorGames: LogGame[];
  season: Counting;
  seasonGames: number;
  /** When false, season rates come from `priorGames` totals (no xG, no leakage). */
  useMoneyPuckSeason: boolean;
  oppFactor: number;
  goalieFactor: number;
  goalieReason: string;
};

export function projectPlayer(input: PlayerProjectionInput): MarketProjection[] | null {
  const seasonSource = input.useMoneyPuckSeason ? input.season : aggregate(input.priorGames);
  const seasonGames = input.useMoneyPuckSeason ? input.seasonGames : input.priorGames.length;
  const recent = weightedRecent(input.priorGames);
  const recentMinutes = recent.toiSeconds / 60;

  const seasonGoals = goalRatePer60(
    seasonSource.goals,
    input.useMoneyPuckSeason ? seasonSource.xGoals : null,
    seasonSource.toiSeconds,
  );
  const seasonAssists = per60(seasonSource.assists, seasonSource.toiSeconds);
  const seasonShots = per60(seasonSource.shots, seasonSource.toiSeconds);
  const recentGoals = per60(recent.goals, recent.toiSeconds);
  const recentAssists = per60(recent.assists, recent.toiSeconds);
  const recentShots = per60(recent.shots, recent.toiSeconds);

  const goalsPer60 = blendRate(recentGoals, seasonGoals, recentMinutes);
  const assistsPer60 = blendRate(recentAssists, seasonAssists, recentMinutes);
  const shotsPer60 = blendRate(recentShots, seasonShots, recentMinutes);
  if (goalsPer60 == null || assistsPer60 == null || shotsPer60 == null) return null;

  const seasonToi =
    seasonGames > 0 && seasonSource.toiSeconds > 0
      ? seasonSource.toiSeconds / seasonGames / 60
      : null;
  const recentToi = averageToiMinutes(input.priorGames, MODEL.toiRecentGames);
  const toiMinutes = projectToiMinutes(recentToi, seasonToi);
  if (toiMinutes == null || !(toiMinutes > 0)) return null;

  const expected = expectedCounts({
    goalsPer60,
    assistsPer60,
    shotsPer60,
    toiMinutes,
    oppFactor: input.oppFactor,
    goalieFactor: input.goalieFactor,
  });

  const share = recentShare(recentMinutes);
  const seasonNote = input.useMoneyPuckSeason
    ? "Season goal rate is half actual goals and half MoneyPuck expected goals."
    : "Season rate is the NHL game log from before this date, so later games are left out.";

  const common = {
    recentGames: Math.min(input.priorGames.length, MODEL.recentGames),
    recentMinutes,
    share,
    toiMinutes,
    oppFactor: input.oppFactor,
    goalieFactor: input.goalieFactor,
    goalieReason: input.goalieReason,
    seasonNote,
  };

  const rows: Array<{ market: MarketId; lambda: number; detail: string }> = [
    {
      market: "anytime_goal",
      lambda: expected.goals,
      detail: rateSentence("goals", recentGoals, seasonGoals, goalsPer60, share) +
        factorSentence(input.oppFactor, input.goalieFactor, true),
    },
    {
      market: "anytime_point",
      lambda: expected.points,
      detail:
        `Expected goals ${expected.goals.toFixed(2)} and expected assists ${expected.assists.toFixed(2)} ` +
        `(assists take ${Math.round(MODEL.assistGoalieDamp * 100)}% of the goalie adjustment).`,
    },
    {
      market: "sog_over_15",
      lambda: expected.shots,
      detail:
        rateSentence("shots", recentShots, seasonShots, shotsPer60, share) +
        ` Opponent shot factor ${input.oppFactor.toFixed(2)}. Shots are not adjusted for the goalie.`,
    },
    {
      market: "sog_over_25",
      lambda: expected.shots,
      detail:
        rateSentence("shots", recentShots, seasonShots, shotsPer60, share) +
        ` Opponent shot factor ${input.oppFactor.toFixed(2)}. Shots are not adjusted for the goalie.`,
    },
  ];

  return rows.map((row) => {
    const target = MARKET_TARGET[row.market];
    const probability = poissonAtLeast(target, row.lambda);
    return {
      market: row.market,
      probability,
      lambda: row.lambda,
      target,
      explanation: [
        `${MARKET_LABEL[row.market]}.`,
        row.detail,
        `Projected ice time ${common.toiMinutes.toFixed(1)} min from a ${Math.round(MODEL.toiRecentWeight * 100)}/${Math.round((1 - MODEL.toiRecentWeight) * 100)} recent/season blend.`,
        `Recent window: last ${common.recentGames} games, decay ${MODEL.recentDecay}, ${common.recentMinutes.toFixed(0)} weighted minutes, recent share ${Math.round(common.share * 100)}%.`,
        common.goalieReason,
        `Expected count ${row.lambda.toFixed(2)}. Poisson P(${target} or more) = ${(probability * 100).toFixed(1)}%.`,
        common.seasonNote,
      ].join(" "),
    };
  });
}

function rateSentence(
  label: string,
  recent: number | null,
  season: number | null,
  blended: number | null,
  share: number,
): string {
  const fmt = (value: number | null) => (value == null ? "n/a" : value.toFixed(2));
  return (
    `Recent ${fmt(recent)} ${label}/60, season ${fmt(season)} ${label}/60, ` +
    `blended ${fmt(blended)} ${label}/60 at a ${Math.round(share * 100)}% recent share.`
  );
}

function factorSentence(opp: number, goalie: number, includeGoalie: boolean): string {
  if (!includeGoalie) return ` Opponent shot factor ${opp.toFixed(2)}.`;
  return ` Opponent shot factor ${opp.toFixed(2)}, goalie factor ${goalie.toFixed(2)}.`;
}
