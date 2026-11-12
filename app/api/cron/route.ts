import { runDaily } from "@/lib/job/run";

export const maxDuration = 60;

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}

async function handle(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await runDaily();
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Job failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
