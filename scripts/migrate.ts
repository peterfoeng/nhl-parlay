import { readdir, readFile } from "node:fs/promises";
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

  const directory = path.join(process.cwd(), "db/migrations");
  const files = (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort();
  for (const file of files) {
    const text = await readFile(path.join(directory, file), "utf8");
    await sql.unsafe(text);
    console.log(`Applied db/migrations/${file}`);
  }
  await sql.end();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
