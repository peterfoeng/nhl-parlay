import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fetchOddsApi, oddsApiCreditCost, oddsApiSettings, readOddsApiKey } from "@/lib/odds/odds-api";
import { fetchAllOdds } from "@/lib/odds/providers";
import { resetStoreForTests } from "@/lib/storage";
import type { ScheduledGame } from "@/lib/types";

const envKeys = ["ODDS_API_KEY", "ODDS_API_REGIONS", "ODDS_API_MARKETS", "ODDS_API_CACHE_HOURS", "DATA_DIR", "ODDS_PROVIDERS"] as const;
const previousEnv = new Map<string, string | undefined>();
let directory = "";

afterEach(async () => {
  globalThis.fetch = originalFetch;
  if (previousEnv.size) {
    for (const key of envKeys) {
      const value = previousEnv.get(key);
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
    previousEnv.clear();
  }
  resetStoreForTests();
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = "";
});

const originalFetch = globalThis.fetch;

describe("odds api settings", () => {
  it("defaults to three US markets, which is 3 credits per game", () => {
    const settings = oddsApiSettings({});
    expect(settings.markets).toEqual(["player_goal_scorer_anytime", "player_points", "player_shots_on_goal"]);
    expect(settings.regions).toEqual(["us"]);
    expect(oddsApiCreditCost(settings)).toBe(3);
    expect(oddsApiCreditCost(oddsApiSettings({ ODDS_API_REGIONS: "us, us2", ODDS_API_MARKETS: "player_points" }))).toBe(2);
    expect(readOddsApiKey({})).toBe("");
    expect(readOddsApiKey({ ODDS_API_KEY: "  abc  " })).toBe("abc");
  });
});

describe("odds api requests", () => {
  it("prices only the slate event, records remaining credits, and does not spend them again from cache", async () => {
    await useTempStore();
    process.env.ODDS_API_KEY = "super-secret-test-key";
    delete process.env.ODDS_API_REGIONS;
    delete process.env.ODDS_API_MARKETS;
    delete process.env.ODDS_API_CACHE_HOURS;
    const seen: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = decodeURIComponent(String(input));
      seen.push(url.replace(/apiKey=[^&]+/, "apiKey=REDACTED"));
      if (url.includes("/events?")) {
        return jsonResponse(
          [
            {
              id: "evt-slate",
              commence_time: "2026-11-13T00:00:00Z",
              away_team: "Vancouver Canucks",
              home_team: "New York Rangers",
            },
            {
              id: "evt-other",
              commence_time: "2026-11-13T00:00:00Z",
              away_team: "Boston Bruins",
              home_team: "Toronto Maple Leafs",
            },
          ],
          { "x-requests-remaining": "490", "x-requests-last": "0" },
        );
      }
      return jsonResponse(
        {
          bookmakers: [
            {
              key: "draftkings",
              markets: [
                {
                  key: "player_goal_scorer_anytime",
                  outcomes: [{ name: "Yes", description: "N. Kucherov", price: 3.2 }],
                },
                {
                  key: "player_points",
                  outcomes: [{ name: "Over", description: "Érik Karlsson", price: 1.8, point: 0.5 }],
                },
                {
                  key: "player_shots_on_goal",
                  outcomes: [
                    { name: "Over", description: "Nikita Kucherov", price: 1.9, point: 1.5 },
                    { name: "Over", description: "Nikita Kucherov", price: 2.4, point: 2.5 },
                  ],
                },
              ],
            },
          ],
        },
        { "x-requests-remaining": "487", "x-requests-last": "3" },
      );
    }) as typeof fetch;

    const first = await fetchOddsApi([slateGame()]);
    expect(seen).toHaveLength(2);
    const oddsUrl = seen.find((url) => url.includes("/odds?"));
    expect(oddsUrl).toContain("/events/evt-slate/odds?");
    expect(oddsUrl).toContain("regions=us");
    expect(oddsUrl).toContain("oddsFormat=decimal");
    expect(oddsUrl).toContain("markets=player_goal_scorer_anytime,player_points,player_shots_on_goal");
    expect(oddsUrl).toContain("apiKey=REDACTED");
    expect(oddsUrl).not.toContain("super-secret-test-key");
    expect(seen.some((url) => url.includes("evt-other"))).toBe(false);
    expect(first.ok).toBe(true);
    expect(first.requestsRemaining).toBe(487);
    expect(first.creditsUsed).toBe(3);
    expect(first.fromCache).toBeUndefined();
    expect(first.quotes.map((quote) => `${quote.market}:${quote.playerName}`)).toEqual([
      "anytime_goal:N. Kucherov",
      "anytime_point:Érik Karlsson",
      "sog_over_15:Nikita Kucherov",
      "sog_over_25:Nikita Kucherov",
    ]);

    const cachedFiles = await readdir(path.join(directory, "cache"));
    const cachedText = (
      await Promise.all(cachedFiles.map((file) => readFile(path.join(directory, "cache", file), "utf8")))
    ).join("\n");
    expect(cachedText).not.toContain("super-secret-test-key");

    const second = await fetchOddsApi([slateGame()]);
    expect(seen).toHaveLength(2);
    expect(second.creditsUsed).toBe(0);
    expect(second.fromCache).toBe(true);
    expect(second.requestsRemaining).toBe(487);
    expect(second.quotes).toHaveLength(4);
  });

  it("does not call the API when the key is missing or every game has started", async () => {
    await useTempStore();
    delete process.env.ODDS_API_KEY;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return jsonResponse([], {});
    }) as typeof fetch;

    const missing = await fetchOddsApi([slateGame()]);
    expect(missing).toMatchObject({ id: "oddsapi", ok: false, skipped: true, error: "ODDS_API_KEY is not set." });
    expect(calls).toBe(0);

    process.env.ODDS_PROVIDERS = "sportsbet,pointsbet,oddsapi";
    const kept = await fetchAllOdds([]);
    expect(kept.map((result) => result.id)).toEqual(["sportsbet", "pointsbet", "oddsapi"]);
    expect(kept.every((result) => result.ok && result.quotes.length === 0 && !result.skipped)).toBe(true);
    expect(kept[2].error).toBe("No games still to start; stored prices kept.");
    expect(calls).toBe(0);
  });
});

async function useTempStore(): Promise<void> {
  for (const key of envKeys) previousEnv.set(key, process.env[key]);
  directory = await mkdtemp(path.join(tmpdir(), "odds-api-"));
  process.env.DATA_DIR = directory;
  resetStoreForTests();
}

function jsonResponse(body: unknown, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", ...headers },
  });
}

function slateGame(): ScheduledGame {
  return {
    id: 2,
    slateDate: "2026-11-12",
    season: 20262027,
    startTimeUtc: "2026-11-13T00:00:00Z",
    gameState: "FUT",
    away: { abbrev: "VAN", common: "Canucks", place: "Vancouver", logo: "" },
    home: { abbrev: "NYR", common: "Rangers", place: "New York", logo: "" },
  };
}
