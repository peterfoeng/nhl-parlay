"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { MultiCard } from "@/components/multi-card";
import { TrackedList } from "@/components/tracked-list";
import { useLiveBoards } from "@/components/use-live-boards";
import { round } from "@/lib/format";
import { impliedProbability } from "@/lib/odds/decimal";
import { isMultiSize, MULTI_SIZES, multiNeedsPoll, sameLegSet, toTrackedLeg } from "@/lib/multis/track";
import { combinedDecimalOdds, combinedModelProbability, selectMulti } from "@/lib/parlay/select";
import type { Slate, TrackedMulti } from "@/lib/types";

export function MultiBuilder({
  slate,
  poll,
  tracked,
}: {
  slate: Slate;
  poll: boolean;
  tracked: TrackedMulti[];
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [saved, setSaved] = useState(tracked);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const extraDates = useMemo(() => {
    const dates = new Set<string>();
    for (const multi of saved) {
      if (multi.slateDate !== slate.slateDate && multiNeedsPoll(multi)) dates.add(multi.slateDate);
    }
    return [...dates].sort();
  }, [saved, slate.slateDate]);
  const live = useLiveBoards(slate, poll, extraDates);
  const size = parseSize(searchParams.get("legs"));
  const built = build(live.slate, size);
  const already = built.legs.length > 0 && saved.some((multi) => multi.slateDate === live.slate.slateDate && sameLegSet(multi, built.legs.map((leg) => leg.id)));

  async function track() {
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch("/api/multis", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slateDate: live.slate.slateDate, size }),
      });
      const body = (await response.json().catch(() => null)) as { error?: string; multi?: TrackedMulti } | null;
      if (!response.ok || !body?.multi) {
        setMessage(body?.error ?? "Could not save that multi.");
        return;
      }
      setSaved((current) => [body.multi as TrackedMulti, ...current.filter((multi) => multi.id !== body.multi?.id)]);
      setMessage(response.status === 200 ? "Already tracking this multi." : "Tracked.");
    } catch {
      setMessage("Could not save that multi.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <p className="mb-3 text-sm text-muted">
        NHL slate {live.slate.slateDate}. First puck {live.slate.firstPuck} Melbourne.
        {live.polling ? " Live games refresh every 60 seconds while this page is open." : ""}
      </p>
      <fieldset>
        <legend className="text-sm font-medium">Legs</legend>
        <div className="mt-2 grid grid-cols-5 gap-2">
          {MULTI_SIZES.map((option) => {
            const params = new URLSearchParams(searchParams.toString());
            if (option === 3) params.delete("legs");
            else params.set("legs", String(option));
            const qs = params.toString();
            const href = qs ? `${pathname}?${qs}` : pathname;
            const active = option === size;
            return (
              <Link
                key={option}
                href={href}
                scroll={false}
                aria-current={active ? "true" : undefined}
                className={`rounded-xl px-2 py-2 text-center text-sm font-semibold tabular-nums ${
                  active ? "bg-[#3ddc97] text-[#06281c]" : "bg-white/8 text-muted"
                }`}
              >
                {option}
              </Link>
            );
          })}
        </div>
      </fieldset>

      <div className="mt-4">
        {built.legs.length > 0 ? (
          <>
            <MultiCard
              title={`${size}-leg multi`}
              legs={built.legs.map(toTrackedLeg)}
              decimalOdds={built.decimalOdds}
              modelProb={built.modelProb}
              edge={built.edge}
              asOf={live.asOf}
            />
            <button
              type="button"
              onClick={track}
              disabled={pending || already}
              className="mt-3 w-full rounded-xl bg-[#3ddc97] px-4 py-3 text-sm font-semibold text-[#06281c] disabled:opacity-60"
            >
              {already ? "Tracked" : pending ? "Saving…" : "Track this multi"}
            </button>
          </>
        ) : (
          <section className="rounded-2xl border border-white/10 bg-card px-5 py-6">
            <h2 className="text-xl font-semibold">No {size}-leg multi</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">{built.note}</p>
          </section>
        )}
        {message ? (
          <p role="status" className="mt-2 text-sm text-muted">
            {message}
          </p>
        ) : null}
      </div>

      <TrackedList
        multis={saved}
        boards={live.boards}
        asOf={live.asOf}
        onChange={setSaved}
        empty="No tracked multi yet. Build one above, then track it."
      />
    </div>
  );
}

function parseSize(value: string | null): number {
  const size = Number(value);
  return isMultiSize(size) ? size : 3;
}

function build(slate: Slate, size: number) {
  const selection = selectMulti(
    slate.legs.map((leg) => ({
      id: leg.id,
      gameId: leg.gameId,
      modelProb: leg.modelProb,
      decimalOdds: leg.decimalOdds,
      edge: leg.edge,
    })),
    size,
  );
  const legs = (selection.legIds ?? [])
    .map((id) => slate.legs.find((leg) => leg.id === id))
    .filter((leg): leg is Slate["legs"][number] => leg != null);
  if (!selection.legIds || legs.length !== size) {
    return { legs: [], note: selection.note, decimalOdds: 0, modelProb: 0, edge: 0 };
  }
  const decimalOdds = round(combinedDecimalOdds(legs.map((leg) => leg.decimalOdds ?? 0)), 4);
  const modelProb = round(combinedModelProbability(legs.map((leg) => leg.modelProb)));
  const implied = impliedProbability(decimalOdds) ?? 0;
  return { legs, note: selection.note, decimalOdds, modelProb, edge: round(modelProb - implied) };
}
