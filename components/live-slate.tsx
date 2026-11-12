"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Board } from "@/components/board";
import { ParlayCard } from "@/components/parlay-card";
import type { Slate } from "@/lib/types";

export function LiveSlate({
  slate,
  poll,
  otherDates,
}: {
  slate: Slate;
  poll: boolean;
  otherDates: string[];
}) {
  const [data, setData] = useState(slate);
  const [asOf, setAsOf] = useState(slate.gradedAt ?? slate.builtAt);
  const [keepPolling, setKeepPolling] = useState(poll);

  useEffect(() => {
    if (!keepPolling) return;
    let timer = 0;
    let cancelled = false;
    const tick = async () => {
      try {
        const response = await fetch(`/api/live?date=${encodeURIComponent(slate.slateDate)}`);
        if (response.ok) {
          const body = (await response.json()) as { slate: Slate; poll: boolean; asOf: string };
          if (!cancelled) {
            setData(body.slate);
            setAsOf(body.asOf);
            setKeepPolling(body.poll);
            if (!body.poll) return;
          }
        }
      } catch {
        // The next tick tries again while the page stays open.
      }
      if (!cancelled) timer = window.setTimeout(tick, 60_000);
    };
    timer = window.setTimeout(tick, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [keepPolling, slate.slateDate]);

  const others = otherDates.filter((date) => date !== data.slateDate);

  return (
    <div>
      <p className="mb-3 text-sm text-muted">
        NHL slate {data.slateDate}. First puck {data.firstPuck} Melbourne.
        {keepPolling ? " Live games refresh every 60 seconds while this page is open." : ""}
      </p>
      <ParlayCard slate={data} asOf={asOf} />
      <p className="mt-3 text-xs leading-relaxed text-muted">{data.modelNote}</p>
      <OddsNotes slate={data} />
      <Board legs={data.legs} />
      {others.length > 0 ? (
        <p className="mt-6 text-sm text-muted">
          Other slates:{" "}
          {others.map((date, index) => (
            <span key={date}>
              {index > 0 ? " · " : ""}
              <Link href={`/day/${date}`} className="underline decoration-white/20 underline-offset-2">
                {date}
              </Link>
            </span>
          ))}
        </p>
      ) : null}
    </div>
  );
}

function providerLabel(id: string): string {
  if (id === "sportsbet") return "Sportsbet";
  if (id === "pointsbet") return "PointsBet";
  if (id === "oddsapi") return "The Odds API";
  return id;
}

function OddsNotes({ slate }: { slate: Slate }) {
  if (!slate.oddsReport.length) return null;
  return (
    <ul className="mt-3 space-y-1 text-xs text-muted">
      {slate.oddsReport.map((item) => (
        <li key={item.id}>
          {providerLabel(item.id)}: {item.skipped ? "not configured" : item.ok ? `${item.quotes} prices` : item.error}
        </li>
      ))}
    </ul>
  );
}
