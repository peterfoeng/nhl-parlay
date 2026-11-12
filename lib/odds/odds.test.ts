import { describe, expect, it } from "vitest";
import { quotesFromOddsApi } from "@/lib/odds/odds-api";
import { quotesFromPointsbetEvent } from "@/lib/odds/pointsbet";
import { quotesFromSportsbetPayload } from "@/lib/odds/classify";
import { americanToDecimal, edge, impliedProbability, toDecimalOdds } from "@/lib/odds/decimal";
import { matchEventToGame } from "@/lib/odds/match";
import { namesMatch, quoteMatchesPlayer } from "@/lib/odds/names";

describe("decimal odds", () => {
  it("converts American prices and reads implied probability", () => {
    expect(americanToDecimal(155)).toBeCloseTo(2.55, 8);
    expect(americanToDecimal(-135)).toBeCloseTo(1 + 100 / 135, 8);
    expect(toDecimalOdds(2.4)).toBe(2.4);
    expect(toDecimalOdds(155)).toBeCloseTo(2.55, 8);
    expect(toDecimalOdds(1)).toBeNull();
    expect(impliedProbability(2.5)).toBeCloseTo(0.4, 8);
    expect(edge(0.46, 2.5)).toBeCloseTo(0.06, 8);
  });
});

describe("names", () => {
  it("matches initials and rejects a shared last name", () => {
    expect(namesMatch("N. Kucherov", "Nikita Kucherov")).toBe(true);
    expect(namesMatch("Erik Karlsson", "Érik Karlsson")).toBe(true);
    expect(namesMatch("Sebastian Aho", "Sebastian Aho")).toBe(true);
    expect(
      quoteMatchesPlayer("Kucherov", "Nikita Kucherov", ["Nikita Kucherov", "Nikolai Kucherov"]),
    ).toBe(false);
    expect(
      quoteMatchesPlayer("N. Kucherov", "Nikita Kucherov", ["Nikita Kucherov", "Tage Thompson"]),
    ).toBe(true);
  });
});

describe("event match", () => {
  it("does not mix up the two New York teams", () => {
    const games = [
      { id: 1, startTimeUtc: "2026-11-13T01:00:00Z", awayCommon: "Islanders", homeCommon: "Kings" },
      { id: 2, startTimeUtc: "2026-11-13T00:00:00Z", awayCommon: "Rangers", homeCommon: "Canucks" },
    ];
    const match = matchEventToGame(
      { away: "New York Rangers", home: "Vancouver Canucks", startsAt: "2026-11-13T00:00:00Z" },
      games,
    );
    expect(match?.id).toBe(2);
  });
});

describe("book parsers", () => {
  it("reads Sportsbet win prices and skips unders", () => {
    const quotes = quotesFromSportsbetPayload(9, [
      {
        name: "Anytime Goalscorer",
        selections: [{ name: "Sebastian Aho", price: { winPrice: 2.4 } }],
      },
      {
        name: "Player Shots on Goal",
        selections: [
          { name: "Sebastian Aho Over 1.5", price: { winPrice: 1.85 } },
          { name: "Sebastian Aho Under 1.5", price: { winPrice: 1.95 } },
          { name: "Sebastian Aho Over 2.5", price: { winPrice: 2.6 } },
        ],
      },
      {
        name: "1st Period Anytime Goalscorer",
        selections: [{ name: "Sebastian Aho", price: { winPrice: 4 } }],
      },
    ]);
    expect(quotes.map((quote) => [quote.market, quote.decimalOdds])).toEqual([
      ["anytime_goal", 2.4],
      ["sog_over_15", 1.85],
      ["sog_over_25", 2.6],
    ]);
    expect(quotes.every((quote) => quote.source === "sportsbet" && quote.gameId === 9)).toBe(true);
  });

  it("reads PointsBet anytime goalscorer prices", () => {
    const quotes = quotesFromPointsbetEvent(4, {
      fixedOddsMarkets: [
        {
          name: "Anytime Goalscorer",
          eventName: "Anytime Goalscorer (Carolina Hurricanes @ Seattle Kraken)",
          isOpenForBetting: true,
          outcomes: [
            { name: "Sebastian Aho", price: 2.4, points: 0.5, isOpenForBetting: true },
            { name: "Closed Skater", price: 3, isOpenForBetting: false },
          ],
        },
        {
          name: "Player To Score 2+ Goals",
          outcomes: [{ name: "Sebastian Aho", price: 6, isOpenForBetting: true }],
        },
      ],
    });
    expect(quotes).toEqual([
      {
        gameId: 4,
        playerName: "Sebastian Aho",
        market: "anytime_goal",
        decimalOdds: 2.4,
        source: "pointsbet",
      },
    ]);
  });

  it("reads The Odds API player markets and keeps the book on the source", () => {
    const quotes = quotesFromOddsApi(3, [
      {
        key: "sportsbet",
        markets: [
          {
            key: "player_points",
            outcomes: [{ name: "Over", description: "Zach Benson", price: 1.74, point: 0.5 }],
          },
          {
            key: "player_shots_on_goal",
            outcomes: [
              { name: "Over", description: "John Carlson", price: 1.69, point: 1.5 },
              { name: "Under", description: "John Carlson", price: 2.1, point: 1.5 },
            ],
          },
        ],
      },
    ]);
    expect(quotes.map((quote) => `${quote.source}:${quote.market}:${quote.playerName}`)).toEqual([
      "oddsapi:sportsbet:anytime_point:Zach Benson",
      "oddsapi:sportsbet:sog_over_15:John Carlson",
    ]);
  });
});
