export const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export async function getText(
  url: string,
  init?: { headers?: Record<string, string>; timeoutMs?: number; accept?: string },
): Promise<{ ok: boolean; status: number; text: string; url: string }> {
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(init?.timeoutMs ?? 25000),
    headers: {
      "User-Agent": BROWSER_UA,
      Accept: init?.accept ?? "application/json, text/plain, */*",
      "Accept-Language": "en-AU,en;q=0.9",
      ...init?.headers,
    },
  });
  const text = await response.text();
  return { ok: response.ok, status: response.status, text, url: response.url };
}

export async function mapPool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}
