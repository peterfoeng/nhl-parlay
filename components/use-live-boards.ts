"use client";

import { useEffect, useState } from "react";
import type { Slate } from "@/lib/types";

type LiveBody = { slate: Slate; poll: boolean; asOf: string };

/**
 * Refresh box scores from `/api/live` while this page is open.
 * The route reads the NHL API. It does not call the odds provider.
 */
export function useLiveBoards(slate: Slate, poll: boolean, extraDates: string[]) {
  const [boards, setBoards] = useState<Record<string, Slate>>({ [slate.slateDate]: slate });
  const [asOf, setAsOf] = useState(slate.gradedAt ?? slate.builtAt);
  const [mainPoll, setMainPoll] = useState(poll);
  const primary = slate.slateDate;
  const extraKey = extraDates.join(",");

  useEffect(() => {
    const dates = [
      ...new Set([...(mainPoll ? [primary] : []), ...extraKey.split(",").filter(Boolean)]),
    ];
    if (!dates.length) return;
    let timer = 0;
    let cancelled = false;
    const tick = async () => {
      try {
        const bodies = (
          await Promise.all(
            dates.map(async (date) => {
              const response = await fetch(`/api/live?date=${encodeURIComponent(date)}`);
              if (!response.ok) return null;
              return (await response.json()) as LiveBody;
            }),
          )
        ).filter((body): body is LiveBody => body != null);
        if (cancelled) return;
        if (bodies.length) {
          setBoards((current) => {
            const next = { ...current };
            for (const body of bodies) next[body.slate.slateDate] = body.slate;
            return next;
          });
          const main = bodies.find((body) => body.slate.slateDate === primary);
          if (main) {
            setAsOf(main.asOf);
            setMainPoll(main.poll);
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
  }, [extraKey, mainPoll, primary]);

  return {
    slate: boards[primary] ?? slate,
    boards,
    asOf,
    polling: mainPoll,
  };
}
