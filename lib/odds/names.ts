export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Full name, or the same last name with a matching first name or initials. */
export function namesMatch(quoteName: string, playerName: string): boolean {
  const quote = tokenize(quoteName);
  const player = tokenize(playerName);
  if (!quote.length || !player.length) return false;
  if (quote.join(" ") === player.join(" ")) return true;
  if (quote[quote.length - 1] !== player[player.length - 1]) return false;
  if (quote.length === 1 || player.length === 1) return true;
  return givenNamesMatch(quote.slice(0, -1), player.slice(0, -1));
}

function tokenize(name: string): string[] {
  return normalizeName(name).split(" ").filter(Boolean);
}

/** Single letters only, so "J. T." is initials and "JT" is a name. */
function isInitials(tokens: string[]): boolean {
  return tokens.length > 0 && tokens.every((token) => token.length === 1);
}

function givenNamesMatch(quote: string[], player: string[]): boolean {
  const quoteInitials = isInitials(quote);
  const playerInitials = isInitials(player);
  if (quoteInitials || playerInitials) {
    if (quoteInitials && playerInitials) return quote.join("") === player.join("");
    const initials = quoteInitials ? quote : player;
    const full = quoteInitials ? player : quote;
    return initialsCover(initials, full);
  }
  return quote.join(" ") === player.join(" ");
}

function initialsCover(initials: string[], full: string[]): boolean {
  if (initials.length === 1) return full[0]?.startsWith(initials[0]) ?? false;
  if (full.length === 1) return full[0].startsWith(initials.join(""));
  if (initials.length !== full.length) return false;
  return initials.every((initial, index) => full[index].startsWith(initial));
}

/** The one roster id this quote names, or null when it is missing or ambiguous. */
export function playerIdForQuote(
  quoteName: string,
  players: Array<{ id: number; name: string }>,
): number | null {
  const names = players.map((player) => player.name);
  const hits = players.filter((player) => quoteMatchesPlayer(quoteName, player.name, names));
  return hits.length === 1 ? hits[0].id : null;
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
