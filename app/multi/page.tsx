import { Suspense } from "react";
import { connection } from "next/server";
import { MultiBuilder } from "@/components/multi-builder";
import { readTracked } from "@/lib/multis/persist";
import { pickFeatured } from "@/lib/slate/feature";
import { shouldPoll } from "@/lib/slate/build";
import { getStore } from "@/lib/storage";
import type { Slate } from "@/lib/types";

export default function Page() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading the board…</p>}>
      <MultiBody />
    </Suspense>
  );
}

async function MultiBody() {
  await connection();
  const store = getStore();
  const slates = await store.listSlates();
  const slate = pickFeatured(slates);
  if (!slate) {
    return (
      <section className="rounded-2xl border border-white/10 bg-card px-5 py-8">
        <h1 className="text-xl font-semibold">No slate saved yet</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          The multi is built from a saved slate. Times on this site are Australia/Melbourne.
        </p>
      </section>
    );
  }
  const tracked = await readTracked(slates);
  return (
    <MultiBuilder
      key={`${slate.slateDate}:${slate.builtAt}`}
      slate={slim(slate)}
      poll={shouldPoll(slate)}
      tracked={tracked}
    />
  );
}

function slim(slate: Slate): Slate {
  return {
    ...slate,
    oddsReport: [],
    legs: slate.legs.map((leg) => ({ ...leg, explanation: "" })),
  };
}
