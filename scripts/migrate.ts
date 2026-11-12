import { readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log("DATABASE_URL is unset. Local runs use the JSON file in ./data, so there is nothing to migrate.");
    return;
  }

  const local = /localhost|127\.0\.0\.1/.test(url);
  const sql = postgres(url, {
    max: 1,
    ...(local || /sslmode=/.test(url) ? {} : { ssl: "require" as const }),
  });

  const file = path.join(process.cwd(), "db/migrations/001_init.sql");
  const text = await readFile(file, "utf8");
  await sql.unsafe(text);
  await sql.end();
  console.log("Applied db/migrations/001_init.sql");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
