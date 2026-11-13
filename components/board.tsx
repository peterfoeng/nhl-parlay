"use client";

import { useMemo } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  MARKET_CHIP,
  parseBoardQuery,
  selectBoard,
  withBoardQuery,
  type BoardQuery,
} from "@/lib/board/view";
import { formatDecimal, formatEdge, formatPercent, sourceLabel } from "@/lib/format";
import { MARKET_LABEL, MARKETS, type MarketId } from "@/lib/model/constants";
import type { Leg, SlateGame } from "@/lib/types";

export function Board({ legs, games }: { legs: Leg[]; games: SlateGame[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const raw = searchParams.toString();
  const query = useMemo(() => parseBoardQuery(new URLSearchParams(raw)), [raw]);
  const selection = useMemo(() => selectBoard(legs, query), [legs, query]);
  const orderedGames = useMemo(
    () => games.toSorted((a, b) => a.startTimeUtc.localeCompare(b.startTimeUtc)),
    [games],
  );

  function href(next: BoardQuery): string {
    const qs = withBoardQuery(new URLSearchParams(raw), next);
    return qs ? `${pathname}?${qs}` : pathname;
  }

  function toggleMarket(id: MarketId): BoardQuery {
    const selected = new Set(query.markets);
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    return { ...query, markets: MARKETS.filter((market) => selected.has(market)), page: 1 };
  }

  return (
    <section className="mt-8">
      <div className="flex items-end justify-between gap-3">
        <h2 className="text-lg font-semibold">Board</h2>
        <p className="text-xs text-muted tabular-nums">
          {selection.view === "all"
            ? `${selection.total} legs`
            : `${selection.shown} of ${selection.total}`}
        </p>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        {query.positiveEdgeOnly && query.pricedOnly
          ? "Priced legs with a positive edge."
          : "Filtered legs."}{" "}
        {query.sort === "model" ? "Sorted by model chance." : "Sorted by edge."}
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        {MARKETS.map((id) => (
          <FilterLink key={id} href={href(toggleMarket(id))} active={query.markets.includes(id)}>
            {MARKET_CHIP[id]}
          </FilterLink>
        ))}
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        <FilterLink href={href({ ...query, pricedOnly: !query.pricedOnly, page: 1 })} active={query.pricedOnly}>
          Priced only
        </FilterLink>
        <FilterLink
          href={href({ ...query, positiveEdgeOnly: !query.positiveEdgeOnly, page: 1 })}
          active={query.positiveEdgeOnly}
        >
          Positive edge
        </FilterLink>
        <FilterLink href={href({ ...query, sort: "edge", page: 1 })} active={query.sort === "edge"}>
          Edge
        </FilterLink>
        <FilterLink href={href({ ...query, sort: "model", page: 1 })} active={query.sort === "model"}>
          Model %
        </FilterLink>
      </div>

      <label className="mt-3 block text-xs text-muted" htmlFor="board-game">
        Game
        <select
          id="board-game"
          value={query.gameId ?? ""}
          onChange={(event) => {
            const value = event.target.value;
            const next = { ...query, gameId: value ? Number(value) : null, page: 1 };
            const qs = withBoardQuery(new URLSearchParams(raw), next);
            router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
          }}
          className="mt-1 w-full rounded-xl border border-white/10 bg-[#0c2230] px-3 py-2 text-sm text-foreground"
        >
          <option value="">All games</option>
          {orderedGames.map((game) => (
            <option key={game.id} value={game.id}>
              {game.awayAbbrev} @ {game.homeAbbrev} · {game.clockLabel}
            </option>
          ))}
        </select>
      </label>

      <div className="mt-3 flex flex-wrap gap-2">
        <FilterLink href={href({ ...query, view: "top", page: 1 })} active={query.view === "top"}>
          Top legs
        </FilterLink>
        <FilterLink href={href({ ...query, view: "game", page: 1 })} active={query.view === "game"}>
          By game
        </FilterLink>
        <FilterLink href={href({ ...query, view: "all", page: 1 })} active={query.view === "all"}>
          Show all
        </FilterLink>
      </div>

      {selection.total === 0 ? (
        <p className="mt-4 text-sm text-muted">
          {query.pricedOnly && query.positiveEdgeOnly
            ? "No priced, positive-edge legs match."
            : "Nothing matches these filters."}
        </p>
      ) : selection.groups ? (
        <div className="mt-3 space-y-4">
          {selection.groups.map((group) => (
            <section key={group.gameId}>
              <h3 className="text-sm font-medium text-[#d7e2ea]">{group.label}</h3>
              <p className="text-xs text-muted">Best {group.legs.length} on this filter</p>
              <ul className="divide-y divide-white/10">
                {group.legs.map((leg) => (
                  <Row key={leg.id} leg={leg} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <ul className="mt-2 divide-y divide-white/10">
          {selection.rows.map((leg) => (
            <Row key={leg.id} leg={leg} />
          ))}
        </ul>
      )}

      {selection.view === "all" && selection.pages > 1 ? (
        <nav aria-label="Board pages" className="mt-3 flex items-center justify-between gap-3 text-sm">
          {selection.page > 1 ? (
            <Link href={href({ ...query, view: "all", page: selection.page - 1 })} scroll={false} className="underline decoration-white/20 underline-offset-2">
              Previous
            </Link>
          ) : (
            <span className="text-muted">Previous</span>
          )}
          <span className="tabular-nums">
            Page {selection.page} of {selection.pages}
          </span>
          {selection.page < selection.pages ? (
            <Link href={href({ ...query, view: "all", page: selection.page + 1 })} scroll={false} className="underline decoration-white/20 underline-offset-2">
              Next
            </Link>
          ) : (
            <span className="text-muted">Next</span>
          )}
        </nav>
      ) : null}
    </section>
  );
}

function Row({ leg }: { leg: Leg }) {
  return (
    <li className="py-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">
            {leg.playerName} <span className="font-normal text-muted">{leg.teamAbbrev}</span>
          </p>
          <p className="truncate text-sm text-muted">
            {MARKET_LABEL[leg.market]} · {leg.matchup} · {leg.clockLabel}
          </p>
        </div>
        <p className="text-base font-semibold tabular-nums">{formatPercent(leg.modelProb)}</p>
      </div>
      <p className="mt-0.5 text-sm">
        {leg.decimalOdds == null || leg.edge == null ? (
          <span className="text-muted">no price</span>
        ) : (
          <span className="text-muted">
            <span className="text-foreground tabular-nums">{formatDecimal(leg.decimalOdds)}</span>
            {" · "}
            edge {formatEdge(leg.edge)} · {sourceLabel(leg.priceSource)}
          </span>
        )}
      </p>
      <p className="text-xs text-muted">{statusText(leg)}</p>
      {leg.explanation ? (
        <details className="mt-0.5">
          <summary className="cursor-pointer text-xs text-[#9ec9c0]">How this was calculated</summary>
          <p className="mt-1 text-sm leading-relaxed text-muted">{leg.explanation}</p>
        </details>
      ) : null}
    </li>
  );
}

function FilterLink({ href, active, children }: { href: string; active: boolean; children: string }) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? "true" : undefined}
      className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${
        active ? "bg-[#3ddc97] text-[#06281c]" : "bg-white/8 text-muted"
      }`}
    >
      {children}
    </Link>
  );
}

function statusText(leg: Leg): string {
  if (leg.status === "void") return "Did not play";
  if (leg.status === "hit") return `Hit ${leg.current}/${leg.target}`;
  if (leg.status === "dead") return `Missed ${leg.current}/${leg.target}`;
  return `Pending ${leg.current}/${leg.target}`;
}
