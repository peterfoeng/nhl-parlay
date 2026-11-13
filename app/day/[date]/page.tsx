import { Suspense } from "react";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { LiveSlate } from "@/components/live-slate";
import { readTracked } from "@/lib/multis/persist";
import { shouldPoll } from "@/lib/slate/build";
import { getStore } from "@/lib/storage";

export default function Page({ params }: { params: Promise<{ date: string }> }) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading the slate…</p>}>
      <DayBody params={params} />
    </Suspense>
  );
}

async function DayBody({ params }: { params: Promise<{ date: string }> }) {
  await connection();
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound();
  const slates = await getStore().listSlates();
  const slate = slates.find((item) => item.slateDate === date);
  if (!slate) {
    return (
      <section className="rounded-2xl border border-white/10 bg-card px-5 py-8">
        <h1 className="text-xl font-semibold">{date}</h1>
        <p className="mt-2 text-sm text-muted">No board has been saved for this NHL date.</p>
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
