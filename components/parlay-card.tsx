import Image from "next/image";
import { dataFooter, formatDecimal, formatEdge, formatPercent, sourceLabel } from "@/lib/format";
import { MARKET_LABEL } from "@/lib/model/constants";
import { formatClockTime } from "@/lib/time";
import type { ParlayStatus } from "@/lib/grading/grade";
import type { Leg, Slate } from "@/lib/types";

export function ParlayCard({ slate, asOf }: { slate: Slate; asOf: string }) {
  const parlay = slate.parlay;
  const legs = (parlay?.legIds ?? [])
    .map((id) => slate.legs.find((leg) => leg.id === id))
    .filter((leg): leg is Leg => Boolean(leg));
  const sources = legs.map((leg) => leg.priceSource);

  return (
    <section className="overflow-hidden rounded-2xl border border-[#1b4d62] bg-[#0c2230] shadow-[0_18px_50px_rgba(0,0,0,0.28)]">
      <div className="px-4 pt-4 sm:px-5">
        <p className="text-[11px] font-medium tracking-[0.16em] text-[#8eb4c6] uppercase">
          NHL Goalscorer Model · My pick
        </p>
        {parlay && legs.length > 0 ? (
          <>
            <div className="mt-2 flex items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-[1.65rem] leading-none font-semibold tracking-tight">3-leg parlay</h2>
                <StatusBadge status={parlay.status} />
              </div>
              <p className="text-[1.65rem] leading-none font-semibold tabular-nums">{formatDecimal(parlay.decimalOdds)}</p>
            </div>
            <p className="mt-2 text-sm text-[#9fb4c2]">
              {slate.melbourneLabel} · {parlay.hitCount} of {legs.length} hit · model {formatPercent(parlay.modelProb)} · edge{" "}
              {formatEdge(parlay.edge)}
            </p>
            <div className="mt-3 flex gap-1.5" aria-hidden>
              {legs.map((leg) => (
                <div key={leg.id} className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#163244]">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: leg.status === "hit" ? "100%" : "0%",
                      background: "#3ddc97",
                    }}
                  />
                </div>
              ))}
            </div>
            <ul className="mt-1 divide-y divide-white/10">
              {legs.map((leg) => (
                <LegRow key={leg.id} leg={leg} />
              ))}
            </ul>
          </>
        ) : (
          <div className="py-6">
            <h2 className="text-xl font-semibold">No 3-leg parlay</h2>
            <p className="mt-2 text-sm leading-relaxed text-[#9fb4c2]">{slate.parlayNote}</p>
          </div>
        )}
      </div>
      <footer className="flex items-end justify-between gap-3 border-t border-white/10 px-4 py-3 text-[11px] leading-snug text-[#8ea6b4] sm:px-5">
        <p>{parlay ? dataFooter(sources) : "Model probabilities, not advice. Data: NHL API, MoneyPuck.com."}</p>
        <p className="shrink-0">as of {formatClockTime(asOf)}</p>
      </footer>
    </section>
  );
}

function LegRow({ leg }: { leg: Leg }) {
  const ratio = leg.target > 0 ? Math.min(1, leg.current / leg.target) : 0;
  const fill = leg.status === "hit" ? "#3ddc97" : leg.status === "dead" ? "#e11d48" : "#4aa3ff";
  return (
    <li className="flex items-center gap-3 py-3">
      <div className="relative h-11 w-11 shrink-0">
        <Image src={leg.headshot} alt="" width={44} height={44} className="h-11 w-11 rounded-full bg-[#163244] object-cover" />
        {leg.teamLogo ? (
          <span className="absolute -right-1 -bottom-1 flex h-5 w-5 items-center justify-center rounded-full bg-[#071820] ring-2 ring-[#0c2230]">
            <Image src={leg.teamLogo} alt="" width={14} height={14} className="h-3.5 w-3.5 object-contain" />
          </span>
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="truncate font-semibold">{leg.playerName}</p>
          {leg.status === "hit" ? <Check /> : null}
          {leg.status === "dead" ? <span className="text-xs font-semibold text-rose-400">✕</span> : null}
        </div>
        <p className="text-xs leading-snug text-[#93a8b8]">
          {MARKET_LABEL[leg.market]} · {leg.matchup} · {leg.clockLabel}
        </p>
        <div className="mt-1.5 flex items-center gap-2">
          <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[#163244]">
            <div className="h-full rounded-full" style={{ width: `${ratio * 100}%`, background: fill }} />
          </div>
          <span className={`w-8 text-right text-xs tabular-nums ${leg.status === "hit" ? "text-[#3ddc97]" : "text-[#b7c7d1]"}`}>
            {leg.status === "void" ? "DNP" : `${leg.current}/${leg.target}`}
          </span>
        </div>
      </div>
      <div className="w-16 shrink-0 text-right">
        <p className="text-xl leading-none font-semibold tabular-nums">{formatPercent(leg.modelProb, 0)}</p>
        <p className="mt-1 text-xs text-[#93a8b8] tabular-nums" title={sourceLabel(leg.priceSource)}>
          {leg.decimalOdds == null ? "no price" : formatDecimal(leg.decimalOdds)}
        </p>
      </div>
    </li>
  );
}

function StatusBadge({ status }: { status: ParlayStatus }) {
  const styles: Record<ParlayStatus, string> = {
    ALIVE: "bg-[#3ddc97] text-[#06281c]",
    WON: "bg-[#3ddc97] text-[#06281c]",
    LOST: "bg-rose-500 text-white",
    VOID: "bg-amber-300 text-[#2a2110]",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold tracking-wide ${styles[status]}`}>{status}</span>
  );
}

function Check() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0 text-[#3ddc97]" aria-label="Hit" role="img">
      <path d="M3 8.2 6.2 11.4 13 4.6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
