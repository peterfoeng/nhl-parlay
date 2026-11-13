import { removeTrackedMulti } from "@/lib/multis/persist";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!id || id.length > 80) return Response.json({ error: "That multi is not saved." }, { status: 404 });
  try {
    const result = await removeTrackedMulti(id);
    if (!result.ok) return Response.json({ error: result.note }, { status: result.missing ? 404 : 409 });
    return Response.json({ ok: true });
  } catch (error) {
    console.log(`[multis] remove failed: ${error instanceof Error ? error.message : error}`);
    return Response.json({ error: "Could not remove that multi." }, { status: 500 });
  }
}
