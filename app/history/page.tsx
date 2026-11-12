import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { formatDecimal, formatPercent, formatUnits } from "@/lib/format";
import { summarizeHistory, type SummaryParlay } from "@/lib/history/summary";
import { getStore } from "@/lib/storage";

export default function Page() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading the record…</p>}>
      <HistoryBody />
    </Suspense>
  );
}

async function HistoryBody() {
  await connection();
  const slates = await getStore().listSlates();
  const summary = summarizeHistory({
    parlays: slates.flatMap((slate) => (slate.parlay ? [toSummary(slate.slateDate, slate.parlay)] : [])),
    legs: slates.flatMap((slate) =>
      slate.legs.map((leg) => ({ market: leg.market, modelProb: leg.modelProb, status: leg.status })),
    ),
  });
  const open = summary.parlays.filter((parlay) => parlay.status === "ALIVE");
  const settled = summary.parlays.filter((parlay) => parlay.status !== "ALIVE");

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Record</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        Settled parlays are marked to a notional 1 unit so the record has a number on it. That is bookkeeping, not a
        staking suggestion. Calibration uses every graded leg, priced or not. Pending and did-not-play legs are left out.
      </p>

      <section className="mt-5 grid grid-cols-3 gap-2">
        <Stat label="Record" value={`${summary.won}-${summary.lost}-${summary.voided}`} />
        <Stat label="Settled" value={String(summary.settled)} />
        <Stat label="Units" value={formatUnits(summary.profitUnits)} />
      </section>

      <h2 className="mt-8 text-lg font-semibold">Parlays</h2>
      {summary.parlays.length === 0 ? (
        <p className="mt-2 text-sm text-muted">No priced parlay has been saved yet.</p>
      ) : (
        <>
          <ParlayTable title="Open" rows={open} />
          <ParlayTable title="Settled" rows={settled} />
        </>
      )}

      <h2 className="mt-8 text-lg font-semibold">Model against results</h2>
      <p className="mt-1 text-sm text-muted">
        Gap is average model probability minus the actual hit rate. A positive gap means the model sat above what happened.
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs tracking-wide text-muted uppercase">
            <tr>
              <th className="py-2 pr-3 font-medium">Market</th>
              <th className="py-2 pr-3 font-medium">Legs</th>
              <th className="py-2 pr-3 font-medium">Model</th>
              <th className="py-2 pr-3 font-medium">Hit rate</th>
              <th className="py-2 font-medium">Gap</th>
            </tr>
          </thead>
          <tbody>
            {summary.markets.map((market) => (
              <tr key={market.market} className="border-t border-white/10">
                <td className="py-2 pr-3">{market.label}</td>
                <td className="py-2 pr-3 tabular-nums">{market.sample}</td>
                <td className="py-2 pr-3 tabular-nums">{market.averageModel == null ? "—" : formatPercent(market.averageModel)}</td>
                <td className="py-2 pr-3 tabular-nums">{market.hitRate == null ? "—" : formatPercent(market.hitRate)}</td>
                <td className="py-2 tabular-nums">
                  {market.gap == null ? "—" : `${market.gap > 0 ? "+" : ""}${(market.gap * 100).toFixed(1)} pp`}
                  {market.sample > 0 && market.sample < 30 ? <span className="ml-1 text-xs text-muted">thin</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function toSummary(
  slateDate: string,
  parlay: { status: SummaryParlay["status"]; decimalOdds: number; modelProb: number; hitCount: number },
): SummaryParlay {
  return {
    slateDate,
    status: parlay.status,
    decimalOdds: parlay.decimalOdds,
    modelProb: parlay.modelProb,
    hitCount: parlay.hitCount,
    legCount: 3,
  };
}

function ParlayTable({ title, rows }: { title: string; rows: SummaryParlay[] }) {
  if (!rows.length) return null;
  return (
    <div className="mt-3">
      <h3 className="text-sm font-medium text-muted">{title}</h3>
      <div className="mt-1 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs tracking-wide text-muted uppercase">
            <tr>
              <th className="py-2 pr-3 font-medium">Date</th>
              <th className="py-2 pr-3 font-medium">Result</th>
              <th className="py-2 pr-3 font-medium">Price</th>
              <th className="py-2 pr-3 font-medium">Model</th>
              <th className="py-2 font-medium">Units</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const units = row.status === "WON" ? row.decimalOdds - 1 : row.status === "LOST" ? -1 : row.status === "VOID" ? 0 : null;
              return (
                <tr key={row.slateDate} className="border-t border-white/10">
                  <td className="py-2 pr-3">
                    <Link href={`/day/${row.slateDate}`} className="underline decoration-white/20 underline-offset-2">
                      {row.slateDate}
                    </Link>
                  </td>
                  <td className="py-2 pr-3">
                    {row.status} · {row.hitCount}/{row.legCount}
                  </td>
                  <td className="py-2 pr-3 tabular-nums">{formatDecimal(row.decimalOdds)}</td>
                  <td className="py-2 pr-3 tabular-nums">{formatPercent(row.modelProb)}</td>
                  <td className="py-2 tabular-nums">{units == null ? "—" : formatUnits(units)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-card px-3 py-3">
      <p className="text-xs tracking-wide text-muted uppercase">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}
