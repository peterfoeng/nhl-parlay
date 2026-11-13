import { Suspense } from "react";
import { connection } from "next/server";
import { LiveSlate } from "@/components/live-slate";
import { readTracked } from "@/lib/multis/persist";
import { pickFeatured } from "@/lib/slate/feature";
import { shouldPoll } from "@/lib/slate/build";
import { getStore } from "@/lib/storage";

export default function Page() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading the slate…</p>}>
      <HomeBody />
    </Suspense>
  );
}

async function HomeBody() {
  await connection();
  const slates = await getStore().listSlates();
  const slate = pickFeatured(slates);
  if (!slate) {
    return (
      <section className="rounded-2xl border border-white/10 bg-card px-5 py-8">
        <h1 className="text-xl font-semibold">No slate saved yet</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          The morning job builds the next NHL slate and grades the previous one. Run it locally with{" "}
          <code className="text-foreground">npm run job -- --date YYYY-MM-DD</code>. Times on this site are Australia/Melbourne.
          Prices are decimal, and a leg with no posted price stays off the parlay.
        </p>
      </section>
    );
  }
  const tracked = (await readTracked([slate])).filter((multi) => multi.slateDate === slate.slateDate);
  return (
    <LiveSlate
      key={`${slate.slateDate}:${slate.builtAt}`}
      slate={slate}
      poll={shouldPoll(slate)}
      otherDates={slates.map((item) => item.slateDate)}
      tracked={tracked}
    />
  );
}
