# NHL Goalscorer Model

A daily 3-leg NHL player parlay. The model is a short, documented blend of recent and season rates, opponent shot volume and goalie save quality, turned into Poisson probabilities for anytime goals, anytime points, and shot totals. Prices are decimal. Times are Australia/Melbourne.

Model probabilities, not advice. Nothing here suggests a stake.

## Run locally

```bash
npm install
npm run job -- --date 2026-11-12
npm run dev
```

The app is at [http://127.0.0.1:4317](http://127.0.0.1:4317). With `DATABASE_URL` unset, slates and cached downloads live in `./data`.

Grade a finished NHL date (box scores, not a made-up price):

```bash
npm run job -- --grade 2026-11-10
```

`--force` rebuilds a slate even after a game has started. Without it, a started slate keeps the prices it was saved with and only the results move.

`npm run job` with no date does what the morning cron does: build the next open NHL slate and grade the one before it.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Next.js dev server on port 4317 |
| `npm run job -- --date YYYY-MM-DD` | Build that NHL slate |
| `npm run job -- --grade YYYY-MM-DD` | Build if needed, then grade from box scores |
| `npm test` | Unit tests (Poisson, blending, adjustments, parlay, grading) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run build` | Production build |
| `npm run migrate` | Apply `db/migrations/001_init.sql` when `DATABASE_URL` is set |

## Environment

Copy `.env.example` to `.env.local`. No real secrets ship in the repo.

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | No | Postgres (Neon works). Unset uses the JSON file in `DATA_DIR`. |
| `CRON_SECRET` | For `/api/cron` | Vercel sends `Authorization: Bearer <CRON_SECRET>`. The CLI does not use it. |
| `ODDS_API_KEY` | No | The Odds API. The provider stays off when this is empty. |
| `ODDS_PROVIDERS` | No | Default `sportsbet,pointsbet,oddsapi`. |
| `DATA_DIR` | No | File store and download cache. Default `./data`. |

## Data

- NHL API at `https://api-web.nhle.com`: schedule, rosters, game logs, live box scores. The open page polls `/api/live` every 60 seconds only while a game is on or about to start. That route is cacheable for 30 seconds. Nothing polls when the page is closed.
- MoneyPuck season CSVs (skaters, goalies, teams), cached for 18 hours.
- Odds, in order, each allowed to fail:
  - Sportsbet public sportsbook JSON, with a normal browser user-agent and no login.
  - PointsBet public API (`api.au.pointsbet.com`).
  - The Odds API, only with `ODDS_API_KEY`.

A leg without a real price shows “no price” and is not eligible for the parlay. Edge is model probability minus `1 / decimal odds` (vig left in).

## Model and parlay

See the About page in the app for the weights. Short version: last 10 games, decay 0.85, 65% recent once 80 minutes are in, Poisson probabilities, opponent shots-allowed factor and goalie goals-versus-expected clamped. The parlay is the three positive-edge prices from three different games that maximise the product of model probabilities.

## Cron and deploy

`vercel.json` schedules `GET /api/cron` at `0 22 * * *` UTC.

- During Australian daylight saving (AEDT, UTC+11, roughly October to April) that is 9:00am Melbourne.
- During standard time (AEST, UTC+10) it is 8:00am Melbourne.

The route checks `Authorization: Bearer $CRON_SECRET` and returns 401 otherwise. Set `CRON_SECRET` in the Vercel project. The job is safe to run twice: before puck drop it rebuilds, and after a game has started it keeps the saved prices and only grades.

`export const maxDuration = 60` is set on the cron route. The first run of a day downloads MoneyPuck and a few hundred game logs, so a cold start can use most of that minute. Later runs hit the cache. On Vercel’s free tier the cache is the database when `DATABASE_URL` is set (the file system does not persist between invocations).

Deploy:

1. Push the repo and import it in Vercel.
2. Add `CRON_SECRET`. Add `DATABASE_URL` from a Neon (or other Postgres) store if you want the board to survive restarts. Run `npm run migrate` once against that database, or execute `db/migrations/001_init.sql`.
3. Optionally add `ODDS_API_KEY`.
4. Confirm the cron in the project’s Cron Jobs tab. You can also call `/api/cron` yourself with the bearer token.

Local Postgres is optional. Without `DATABASE_URL` the app is fully usable from `./data`.
