"use client";

import { useState } from "react";
import { MultiCard } from "@/components/multi-card";
import { canRemoveTrackedMulti, gradeTrackedMulti } from "@/lib/multis/track";
import type { Slate, TrackedMulti } from "@/lib/types";

export function TrackedList({
  multis,
  boards,
  asOf,
  onChange,
  empty,
}: {
  multis: TrackedMulti[];
  boards: Record<string, Slate | undefined>;
  asOf: string;
  onChange: (multis: TrackedMulti[]) => void;
  empty?: string;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const ordered = multis.toSorted((a, b) => b.savedAt.localeCompare(a.savedAt));

  if (!ordered.length) {
    return empty ? <p className="mt-6 text-sm text-muted">{empty}</p> : null;
  }

  async function remove(id: string) {
    setPendingId(id);
    setMessage(null);
    try {
      const response = await fetch(`/api/multis/${encodeURIComponent(id)}`, { method: "DELETE" });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        setMessage(body?.error ?? "Could not remove that multi.");
        return;
      }
      onChange(multis.filter((multi) => multi.id !== id));
    } catch {
      setMessage("Could not remove that multi.");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <section className="mt-6">
      <h2 className="text-lg font-semibold">Tracked multis</h2>
      <div className="mt-3 space-y-4">
        {ordered.map((multi) => {
          const live = gradeTrackedMulti(multi, boards[multi.slateDate] ?? null);
          const removable = canRemoveTrackedMulti(live);
          return (
            <div key={multi.id}>
              <MultiCard
                title={`${live.size}-leg multi`}
                legs={live.legs}
                decimalOdds={live.decimalOdds}
                modelProb={live.modelProb}
                edge={live.edge}
                asOf={asOf}
                savedLabel={live.savedLabel}
              />
              {removable ? (
                <button
                  type="button"
                  onClick={() => remove(multi.id)}
                  disabled={pendingId === multi.id}
                  className="mt-2 w-full rounded-xl border border-white/15 px-4 py-2 text-sm text-[#d7e2ea] disabled:opacity-60"
                >
                  {pendingId === multi.id ? "Removing…" : "Remove"}
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      {message ? (
        <p role="alert" className="mt-3 text-sm text-rose-300">
          {message}
        </p>
      ) : null}
    </section>
  );
}
