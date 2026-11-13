import { isMultiSize } from "@/lib/multis/track";
import { saveBuiltMulti } from "@/lib/multis/persist";
import { getStore } from "@/lib/storage";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Send a slate date and a size." }, { status: 400 });
  }
  const record = body && typeof body === "object" ? (body as { slateDate?: unknown; size?: unknown }) : {};
  const slateDate = typeof record.slateDate === "string" ? record.slateDate : "";
  const size = typeof record.size === "number" ? record.size : Number(record.size);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(slateDate) || !Number.isInteger(size) || !isMultiSize(size)) {
    return Response.json({ error: "Choose 2 to 6 legs on a saved slate." }, { status: 400 });
  }

  const slate = await getStore().getSlate(slateDate);
  if (!slate) return Response.json({ error: "No slate saved for that date." }, { status: 404 });

  try {
    const result = await saveBuiltMulti(slate, size);
    if (!result.ok) return Response.json({ error: result.note }, { status: 422 });
    return Response.json({ multi: result.multi }, { status: result.existing ? 200 : 201 });
  } catch (error) {
    console.log(`[multis] save failed: ${error instanceof Error ? error.message : error}`);
    return Response.json({ error: "Could not save that multi." }, { status: 500 });
  }
}
