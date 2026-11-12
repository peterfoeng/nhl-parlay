import { MODEL } from "@/lib/model/constants";
import { goalieQualityFactor } from "@/lib/model/adjust";

export type StarterCandidate = {
  playerId: number;
  name: string;
  games: number;
  lastDate: string | null;
  lastToiMinutes: number;
  goalsAgainst: number | null;
  xGoalsAgainst: number | null;
};

export type StarterPick = {
  playerId: number | null;
  name: string | null;
  factor: number | null;
  reason: string;
};

/**
 * Likely starter: the goalie who appeared most recently.
 * On a back-to-back, if that goalie started yesterday and a teammate has a
 * real workload, the teammate is the likely starter instead.
 * Factor is goals allowed / MoneyPuck expected goals, clamped. Null falls back
 * to the team average, which the caller supplies.
 */
export function pickStarter(
  goalies: StarterCandidate[],
  teamPlayedYesterday: boolean,
  yesterday: string | null,
): StarterPick {
  if (!goalies.length) {
    return {
      playerId: null,
      name: null,
      factor: null,
      reason: "No opposing goalie on file, so the goalie factor stays neutral.",
    };
  }

  const ranked = [...goalies].sort((a, b) => {
    const date = (b.lastDate ?? "").localeCompare(a.lastDate ?? "");
    if (date !== 0) return date;
    return b.games - a.games;
  });
  const recent = ranked[0];
  const startedYesterday =
    teamPlayedYesterday &&
    yesterday != null &&
    recent.lastDate === yesterday &&
    recent.lastToiMinutes >= MODEL.backToBackMinutes;

  if (startedYesterday) {
    const backup = goalies
      .filter((goalie) => goalie.playerId !== recent.playerId && goalie.games >= MODEL.backupMinGames)
      .sort((a, b) => b.games - a.games)[0];
    if (backup) {
      return finish(
        backup,
        `Back-to-back: ${recent.name} started yesterday, so ${backup.name} is the likely starter.`,
      );
    }
  }

  if (recent.lastDate) {
    return finish(
      recent,
      `Likely starter ${recent.name}, most recent appearance ${recent.lastDate}.`,
    );
  }

  const byGames = [...goalies].sort((a, b) => b.games - a.games)[0];
  return finish(
    byGames,
    `No recent start on file. Using ${byGames.name}, who has the most games played.`,
  );
}

export function teamGoalieFactor(goalies: StarterCandidate[]): number | null {
  let goals = 0;
  let expected = 0;
  for (const goalie of goalies) {
    if (goalie.goalsAgainst == null || goalie.xGoalsAgainst == null || !(goalie.xGoalsAgainst > 0)) {
      continue;
    }
    goals += goalie.goalsAgainst;
    expected += goalie.xGoalsAgainst;
  }
  return goalieQualityFactor(goals, expected);
}

function finish(goalie: StarterCandidate, reason: string): StarterPick {
  return {
    playerId: goalie.playerId,
    name: goalie.name,
    factor: goalieQualityFactor(goalie.goalsAgainst, goalie.xGoalsAgainst),
    reason,
  };
}
