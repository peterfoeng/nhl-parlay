import type { MarketId } from "@/lib/model/constants";
import { toDecimalOdds } from "@/lib/odds/decimal";
import type { PriceQuote } from "@/lib/odds/types";

export function classifyMarketName(name: string): MarketId | "shots" | null {
  const text = name.toLowerCase().replace(/\s+/g, " ").trim();
  if (!text) return null;
  if (/1st period|2nd period|3rd period|first period|second period|third period|period [123]/.test(text)) {
    return null;
  }
  if (/first goal|1st goal|2\+|3\+|two or more|three or more|to score 2|to score 3|score 2|score 3/.test(text)) {
    return null;
  }
  if (/shot/.test(text)) return "shots";
  if (/1\+ point|anytime point|player points|to record a point|points scorer/.test(text)) {
    return "anytime_point";
  }
  if (/anytime goal|goalscorer|goal scorer|to score/.test(text)) return "anytime_goal";
  return null;
}

export function quotesFromSelections(input: {
  gameId: number;
  source: string;
  marketName: string;
  selections: Array<{
    name?: string;
    playerName?: string;
    price?: number;
    line?: number | null;
    side?: string | null;
  }>;
}): PriceQuote[] {
  const kind = classifyMarketName(input.marketName);
  if (!kind) return [];
  const quotes: PriceQuote[] = [];

  for (const selection of input.selections) {
    const decimal = selection.price == null ? null : toDecimalOdds(selection.price);
    if (decimal == null || !(decimal > 1)) continue;
    const side = `${selection.side ?? ""} ${selection.name ?? ""}`.toLowerCase();
    if (/\bunder\b/.test(side)) continue;

    if (kind === "shots") {
      const parsed = parseShotSelection(input.marketName, selection.name ?? "", selection.playerName, selection.line);
      if (!parsed) continue;
      quotes.push({
        gameId: input.gameId,
        playerName: parsed.playerName,
        market: parsed.market,
        decimalOdds: decimal,
        source: input.source,
      });
      continue;
    }

    const playerName = selection.playerName?.trim() || stripOver(selection.name ?? "");
    if (!playerName || /^(over|yes|no)$/i.test(playerName)) continue;
    quotes.push({
      gameId: input.gameId,
      playerName,
      market: kind,
      decimalOdds: decimal,
      source: input.source,
    });
  }
  return quotes;
}

function parseShotSelection(
  marketName: string,
  selectionName: string,
  playerName: string | undefined,
  line: number | null | undefined,
): { playerName: string; market: MarketId } | null {
  const explicit = line ?? lineInText(`${marketName} ${selectionName}`);
  const market = explicit === 1.5 ? "sog_over_15" : explicit === 2.5 ? "sog_over_25" : null;
  if (!market) return null;

  const fromMarket = playerPrefix(marketName);
  const named = playerName?.trim() || fromMarket || stripOver(selectionName);
  if (!named || /^(over|under|yes|no)$/i.test(named)) return null;
  return { playerName: named, market };
}

function lineInText(text: string): number | null {
  if (/\b1\.5\b/.test(text)) return 1.5;
  if (/\b2\.5\b/.test(text)) return 2.5;
  return null;
}

function stripOver(name: string): string {
  return name
    .replace(/\bover\b/i, " ")
    .replace(/\bunder\b/i, " ")
    .replace(/\b\d+(?:\.\d+)?\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function playerPrefix(marketName: string): string | null {
  const match = /^(.+?)\s*[-–—:]\s*.*shot/i.exec(marketName);
  if (!match) return null;
  const name = match[1].trim();
  return name.length > 1 ? name : null;
}

/** Walk an unknown Sportsbet payload for markets with selections and win prices. */
export function quotesFromSportsbetPayload(gameId: number, payload: unknown): PriceQuote[] {
  const quotes: PriceQuote[] = [];
  walk(payload, (marketName, selections) => {
    quotes.push(
      ...quotesFromSelections({
        gameId,
        source: "sportsbet",
        marketName,
        selections,
      }),
    );
  });
  return quotes;
}

type RawSelection = {
  name?: string;
  playerName?: string;
  price?: number;
  line?: number | null;
  side?: string | null;
};

function walk(
  node: unknown,
  onMarket: (name: string, selections: RawSelection[]) => void,
): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) walk(item, onMarket);
    return;
  }
  const record = node as Record<string, unknown>;
  const name = firstString(record, ["name", "marketName", "eventName"]);
  const selections = firstArray(record, ["selections", "outcomes", "runners"]);
  if (name && selections && classifyMarketName(name)) {
    onMarket(name, selections.map(readSelection).filter((row): row is RawSelection => row != null));
  }
  for (const value of Object.values(record)) {
    if (value && typeof value === "object") walk(value, onMarket);
  }
}

function readSelection(node: unknown): RawSelection | null {
  if (!node || typeof node !== "object") return null;
  const record = node as Record<string, unknown>;
  const name = firstString(record, ["name", "selectionName", "runnerName"]);
  const playerName = firstString(record, ["playerName", "participant"]);
  const line = firstNumber(record, ["line", "handicap", "points"]);
  const price = readPrice(record);
  if (price == null && !name) return null;
  return { name, playerName, price: price ?? undefined, line };
}

function readPrice(record: Record<string, unknown>): number | null {
  const direct = firstNumber(record, ["winPrice", "price", "odds"]);
  if (direct != null && typeof record.price !== "object") return direct;
  if (record.price && typeof record.price === "object") {
    const nested = firstNumber(record.price as Record<string, unknown>, ["winPrice", "decimal", "price"]);
    if (nested != null) return nested;
  }
  if (Array.isArray(record.prices)) {
    for (const item of record.prices) {
      if (item && typeof item === "object") {
        const nested = firstNumber(item as Record<string, unknown>, ["winPrice", "price"]);
        if (nested != null) return nested;
      }
    }
  }
  return direct;
}

function firstString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function firstNumber(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

function firstArray(record: Record<string, unknown>, keys: string[]): unknown[] | null {
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) return value;
  }
  return null;
}
