"use client";

import { useState } from "react";
import { formatDecimal, formatEdge, formatPercent, sourceLabel } from "@/lib/format";
import { MARKET_LABEL, MARKETS, type MarketId } from "@/lib/model/constants";
import type { Leg } from "@/lib/types";

export function Board({ legs }: { legs: Leg[] }) {
  const [market, setMarket] = useState<MarketId | "all">("all");
  const filtered = market === "all" ? legs : legs.filter((leg) => leg.market === market);
  const ordered = [...filtered].sort(compareLegs);
  const counts = Object.fromEntries(MARKETS.map((id) => [id, legs.filter((leg) => leg.market === id).length])) as Record<MarketId, number>;

  return (
    <section className="mt-8">
      <div className="flex items-end justify-between gap-3">
        <h2 className="text-lg font-semibold">Board</h2>
        <p className="text-xs text-muted">{ordered.length} legs</p>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <FilterChip active={market === "all"} onClick={() => setMarket("all")} label={`All ${legs.length}`} />
        {MARKETS.map((id) => (
          <FilterChip
            key={id}
            active={market === id}
            onClick={() => setMarket(id)}
            label={`${MARKET_LABEL[id]} ${counts[id]}`}
          />
        ))}
      </div>
      {ordered.length === 0 ? (
        <p className="mt-4 text-sm text-muted">Nothing in this market.</p>
      ) : (
        <ul className="mt-2 divide-y divide-white/10">
          {ordered.map((leg) => (
            <li key={leg.id} className="py-3">
              <div className="flex items-baseline justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {leg.playerName}{" "}
                    <span className="font-normal text-muted">{leg.teamAbbrev}</span>
                  </p>
                  <p className="truncate text-sm text-muted">
                    {MARKET_LABEL[leg.market]} · {leg.matchup} · {leg.clockLabel}
                  </p>
                </div>
                <p className="text-lg font-semibold tabular-nums">{formatPercent(leg.modelProb)}</p>
              </div>
              <p className="mt-1 text-sm">
                {leg.decimalOdds == null || leg.impliedProb == null || leg.edge == null ? (
                  <span className="text-muted">no price · cannot be in the parlay</span>
                ) : (
                  <span>
                    <span className="tabular-nums">{formatDecimal(leg.decimalOdds)}</span>
                    <span className="text-muted">
                      {" "}
                      · implied {formatPercent(leg.impliedProb)} · edge {formatEdge(leg.edge)} · {sourceLabel(leg.priceSource)}
                    </span>
                  </span>
                )}
              </p>
              <p className="mt-0.5 text-xs text-muted">{statusText(leg)}</p>
              <details className="mt-1">
                <summary className="cursor-pointer text-xs text-[#9ec9c0]">How this was calculated</summary>
                <p className="mt-1 text-sm leading-relaxed text-muted">{leg.explanation}</p>
              </details>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function FilterChip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${
        active ? "bg-[#3ddc97] text-[#06281c]" : "bg-white/8 text-muted"
      }`}
    >
      {label}
    </button>
  );
}

function compareLegs(a: Leg, b: Leg): number {
  const aPriced = a.decimalOdds == null ? 1 : 0;
  const bPriced = b.decimalOdds == null ? 1 : 0;
  if (aPriced !== bPriced) return aPriced - bPriced;
  const edgeDelta = (b.edge ?? -999) - (a.edge ?? -999);
  if (edgeDelta !== 0) return edgeDelta;
  return b.modelProb - a.modelProb;
}

function statusText(leg: Leg): string {
  if (leg.status === "void") return "Did not play";
  if (leg.status === "hit") return `Hit ${leg.current}/${leg.target}`;
  if (leg.status === "dead") return `Missed ${leg.current}/${leg.target}`;
  return `Pending ${leg.current}/${leg.target}`;
}
