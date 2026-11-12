export const MELBOURNE = "Australia/Melbourne";

export function melbourneToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: MELBOURNE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** NHL dates the morning job reads. The day is Melbourne's, not UTC, so the hour inside that morning does not move the window. */
export function melbourneSlateDates(now = new Date()): string[] {
  const today = melbourneToday(now);
  return [shiftDate(today, -2), shiftDate(today, -1), today, shiftDate(today, 1)];
}

export function previousDate(isoDate: string): string {
  return shiftDate(isoDate, -1);
}

export function shiftDate(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function formatSlateDay(isoInstant: string): string {
  const date = new Date(isoInstant);
  const weekday = new Intl.DateTimeFormat("en-AU", {
    timeZone: MELBOURNE,
    weekday: "long",
  }).format(date);
  const day = new Intl.DateTimeFormat("en-AU", {
    timeZone: MELBOURNE,
    day: "numeric",
  }).format(date);
  const month = new Intl.DateTimeFormat("en-AU", {
    timeZone: MELBOURNE,
    month: "long",
  }).format(date);
  return `${weekday}, ${day} ${month}`;
}

export function formatKickoff(isoInstant: string): string {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: MELBOURNE,
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    hourCycle: "h12",
  }).format(new Date(isoInstant));
}

export function formatClockTime(isoInstant: string): string {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: MELBOURNE,
    hour: "numeric",
    minute: "2-digit",
    hourCycle: "h12",
  }).format(new Date(isoInstant));
}

export type PeriodInfo = {
  number?: number;
  periodType?: string;
};

export type ClockInfo = {
  timeRemaining?: string;
  inIntermission?: boolean;
};

export function gameClockLabel(input: {
  gameState: string;
  startTimeUtc: string;
  period?: PeriodInfo | null;
  clock?: ClockInfo | null;
}): string {
  const state = input.gameState;
  if (state === "OFF" || state === "FINAL" || state === "OFFICIAL" || state === "OVER") {
    const periodType = input.period?.periodType;
    if (periodType === "OT") return "Final/OT";
    if (periodType === "SO") return "Final/SO";
    return "Final";
  }
  if (state === "FUT" || state === "PRE") return formatKickoff(input.startTimeUtc);

  const period = input.period;
  const clock = input.clock;
  const label = periodLabel(period);
  if (clock?.inIntermission) return `${label} int.`;
  const remaining = clock?.timeRemaining?.trim();
  return remaining ? `${label} ${remaining}` : label;
}

function periodLabel(period?: PeriodInfo | null): string {
  if (!period) return "Live";
  if (period.periodType === "OT") return "OT";
  if (period.periodType === "SO") return "SO";
  if (period.number === 1) return "1st";
  if (period.number === 2) return "2nd";
  if (period.number === 3) return "3rd";
  if (period.number) return `${period.number}th`;
  return "Live";
}

export type DatedGame = {
  slateDate: string;
  gameState: string;
  startTimeUtc: string;
};

const OPEN_STATES = new Set(["FUT", "PRE", "LIVE", "CRIT"]);

/** Earliest NHL date that still has a game to play or in progress. */
export function chooseOpenSlateDate(games: DatedGame[]): string | null {
  const open = [
    ...new Set(games.filter((game) => OPEN_STATES.has(game.gameState)).map((game) => game.slateDate)),
  ].sort();
  if (open.length) return open[0];
  const all = [...new Set(games.map((game) => game.slateDate))].sort();
  return all.at(-1) ?? null;
}
