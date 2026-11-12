import postgres from "postgres";
import type { Slate } from "@/lib/types";
import type { CacheEntry, Store } from "@/lib/storage/types";

let client: ReturnType<typeof postgres> | null = null;

function sql() {
  if (client) return client;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const local = /localhost|127\.0\.0\.1/.test(url);
  const hasSsl = /sslmode=/.test(url);
  client = postgres(url, {
    max: 1,
    idle_timeout: 20,
    ...(local || hasSsl ? {} : { ssl: "require" as const }),
  });
  return client;
}

export function createPostgresStore(): Store {
  return {
    async getSlate(date) {
      const rows = await sql()<{ payload: Slate }[]>`
        select payload from slates where slate_date = ${date}
      `;
      return rows[0]?.payload ?? null;
    },
    async putSlate(slate) {
      await sql()`
        insert into slates (slate_date, payload, updated_at)
        values (${slate.slateDate}, ${sql().json(slate as never)}, now())
        on conflict (slate_date) do update
        set payload = excluded.payload, updated_at = now()
      `;
    },
    async listSlates() {
      const rows = await sql()<{ payload: Slate }[]>`
        select payload from slates order by slate_date desc
      `;
      return rows.map((row) => row.payload);
    },
    async getCache(key) {
      const rows = await sql()<CacheEntry[]>`
        select body, fetched_at as "fetchedAt" from http_cache where cache_key = ${key}
      `;
      const row = rows[0];
      if (!row) return null;
      return {
        body: row.body,
        fetchedAt: new Date(row.fetchedAt).toISOString(),
      };
    },
    async putCache(key, body, fetchedAt) {
      await sql()`
        insert into http_cache (cache_key, body, fetched_at)
        values (${key}, ${body}, ${fetchedAt})
        on conflict (cache_key) do update
        set body = excluded.body, fetched_at = excluded.fetched_at
      `;
    },
  };
}
