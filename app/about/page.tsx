import { MODEL } from "@/lib/model/constants";
import { PARLAY_RULE } from "@/lib/parlay/select";

export default function AboutPage() {
  return (
    <article className="space-y-6 text-sm leading-relaxed text-[#d5dee6]">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">How the model works</h1>
        <p className="mt-2 text-muted">
          Every number on the card is a count turned into a probability. There is no learned black box. The weights
          below are the ones in the code.
        </p>
      </header>

      <section>
        <h2 className="text-lg font-semibold text-foreground">Rates</h2>
        <p className="mt-2">
          For each skater the model wants goals, assists and shots on goal per 60 minutes. The recent window is the last{" "}
          {MODEL.recentGames} games before the slate. A game {`i`} steps back has weight {MODEL.recentDecay}
          <sup>i</sup>, and the same weights apply to the counting stats and the ice time, so the rate is a recency-weighted
          per-60.
        </p>
        <p className="mt-2">
          That recent rate is blended with a season rate. Once the recent window has {MODEL.fullRecentMinutes} minutes, the
          recent share is {Math.round(MODEL.recentWeight * 100)}%. With less ice time the recent share shrinks in proportion.
          On a current or future slate the season goal rate is {Math.round(MODEL.actualGoalShare * 100)}% actual goals and{" "}
          {Math.round((1 - MODEL.actualGoalShare) * 100)}% MoneyPuck expected goals. Assists and shots use actual counts.
          On a backfilled past date, season rates come only from NHL game logs before that date, so the result is not
          fitted on games that had not been played yet.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-foreground">Ice time and matchup</h2>
        <p className="mt-2">
          Projected ice time is {Math.round(MODEL.toiRecentWeight * 100)}% the average of the last {MODEL.toiRecentGames}{" "}
          games and {Math.round((1 - MODEL.toiRecentWeight) * 100)}% the season average. Expected counts are the blended
          per-60 rate times that ice time, in hours.
        </p>
        <p className="mt-2">
          Opponent shots allowed per 60, from MoneyPuck team totals, are divided by the league rate and clamped between{" "}
          {MODEL.oppFactorMin} and {MODEL.oppFactorMax}. That factor scales shots, goals and assists. The opposing goalie
          factor is goals allowed divided by MoneyPuck expected goals against, clamped between {MODEL.goalieFactorMin} and{" "}
          {MODEL.goalieFactorMax}. It scales goals in full. Assists take {Math.round(MODEL.assistGoalieDamp * 100)}% of the
          same move, because a goalie changes whether a shot becomes a goal more than whether a shot happens. Shots are not
          adjusted for the goalie.
        </p>
        <p className="mt-2">
          The likely starter is the goalie who appeared most recently. If that goalie played at least {MODEL.backToBackMinutes}{" "}
          minutes yesterday and a teammate has at least {MODEL.backupMinGames} games, the teammate is used instead. If that
          goalie has no expected-goals sample, the team’s shot-weighted average is used. If nobody qualifies, the factor is 1.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-foreground">Probabilities</h2>
        <p className="mt-2">
          Goals, points and shots are treated as Poisson counts. Anytime goal and anytime point are the chance of 1 or
          more. Over 1.5 shots is the chance of 2 or more. Over 2.5 shots is the chance of 3 or more. A player needs at
          least {MODEL.minGames} prior games and about {MODEL.minAvgToiMinutes} minutes a night. The board keeps the{" "}
          {MODEL.skatersPerTeam} highest-ice-time skaters per team who clear that bar.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-foreground">Prices and the parlay</h2>
        <p className="mt-2">
          Decimal odds only. Implied probability is 1 divided by the decimal price, vig included, so the edge is a
          conservative comparison. Edge is model probability minus that implied probability. A leg with no real posted
          price is labelled “no price” and cannot be selected. Nothing is estimated to fill a gap.
        </p>
        <p className="mt-2">{PARLAY_RULE}</p>
        <p className="mt-2">
          Providers run in order and a later book does not overwrite an earlier price: Sportsbet, then PointsBet, then The
          Odds API when <code>ODDS_API_KEY</code> is set. One provider failing leaves the others in place. Sportsbet has
          refused this kind of host with a location block before, which is why the chain exists.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-foreground">Grading</h2>
        <p className="mt-2">
          A leg hits as soon as the box score reaches the target, even if the game is still going. A final game that is
          short is dead. A player who is absent or has zero ice time in a final game did not play, and that leg is void.
          The parlay is lost if any leg is dead, won only if every leg hit, and void if a did-not-play leg is the only
          thing keeping it from a win. Otherwise it stays alive. The page asks the NHL API for box scores while it is
          open and a game is on, about once a minute. Nothing polls in the background.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-foreground">What this is not</h2>
        <p className="mt-2">
          Model probabilities, not advice. The history page’s unit profit is a 1-unit record of settled parlays. It is not
          a stake, a bankroll rule, or a suggestion to bet.
        </p>
      </section>
    </article>
  );
}
