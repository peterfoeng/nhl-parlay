export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Full name, or the same last name with a matching first name or first initial. */
export function namesMatch(quoteName: string, playerName: string): boolean {
  const quote = normalizeName(quoteName).split(" ").filter(Boolean);
  const player = normalizeName(playerName).split(" ").filter(Boolean);
  if (!quote.length || !player.length) return false;
  if (quote.join(" ") === player.join(" ")) return true;
  if (quote[quote.length - 1] !== player[player.length - 1]) return false;
  if (quote.length === 1 || player.length === 1) return true;
  const quoteFirst = quote[0];
  const playerFirst = player[0];
  if (quoteFirst.length === 1 || playerFirst.length === 1) {
    return quoteFirst[0] === playerFirst[0];
  }
  return quoteFirst === playerFirst;
}

/**
 * True when the quote names this player and does not also name a teammate.
 * A bare last name that fits two skaters is rejected.
 */
export function quoteMatchesPlayer(
  quoteName: string,
  playerName: string,
  rosterNames: string[],
): boolean {
  if (!namesMatch(quoteName, playerName)) return false;
  const others = rosterNames.filter(
    (name) => name !== playerName && namesMatch(quoteName, name),
  );
  if (!others.length) return true;
  const exact = normalizeName(quoteName);
  return exact === normalizeName(playerName) && others.every((name) => normalizeName(name) !== exact);
}
