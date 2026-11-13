"use client";

import { useState } from "react";
import Link from "next/link";
import { Board } from "@/components/board";
import { ParlayCard } from "@/components/parlay-card";
import { TrackedList } from "@/components/tracked-list";
import { useLiveBoards } from "@/components/use-live-boards";
import type { Slate, TrackedMulti } from "@/lib/types";

export function LiveSlate({
  slate,
  poll,
  otherDates,
  tracked,
}: {
  slate: Slate;
  poll: boolean;
  otherDates: string[];
  tracked: TrackedMulti[];
}) {
  const live = useLiveBoards(slate, poll, []);
  const [multis, setMultis] = useState(tracked);
  const others = otherDates.filter((date) => date !== live.slate.slateDate);
  const mine = multis.filter((multi) => multi.slateDate === live.slate.slateDate);

  return (
    <div>
      <p className="mb-3 text-sm text-muted">
        NHL slate {live.slate.slateDate}. First puck {live.slate.firstPuck} Melbourne.
        {live.polling ? " Live games refresh every 60 seconds while this page is open." : ""}
      </p>
      <ParlayCard slate={live.slate} asOf={live.asOf} />
      <p className="mt-3 text-sm">
        <Link href="/multi" className="underline decoration-white/20 underline-offset-2">
          Build a 2–6 leg multi
        </Link>
      </p>
      <TrackedList
        multis={mine}
        boards={{ [live.slate.slateDate]: live.slate }}
        asOf={live.asOf}
        onChange={(next) =>
          setMultis((current) => [
            ...current.filter((multi) => multi.slateDate !== live.slate.slateDate),
            ...next,
          ])
        }
      />
      <p className="mt-3 text-xs leading-relaxed text-muted">{live.slate.modelNote}</p>
      <OddsNotes slate={live.slate} />
      <Board legs={live.slate.legs} games={live.slate.games} />
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
          {providerLabel(item.id)}: {oddsDetail(item)}
        </li>
      ))}
    </ul>
  );
}

function oddsDetail(item: Slate["oddsReport"][number]): string {
  const usage = [
    item.fromCache ? "cached" : "",
    item.creditsUsed != null ? `${item.creditsUsed} credits this run` : "",
    item.requestsRemaining != null ? `${item.requestsRemaining} credits left` : "",
  ].filter(Boolean);
  if (item.skipped) return [item.error ?? "not configured", ...usage].join(", ");
  if (!item.ok) return [item.error ?? "failed", ...usage].join(", ");
  if (item.quotes === 0 && item.error) return [item.error, ...usage].join(", ");
  return [`${item.quotes} prices`, ...usage, item.error ?? ""].filter(Boolean).join(", ");
}
