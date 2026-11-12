import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Slate } from "@/lib/types";
import type { CacheEntry, Store } from "@/lib/storage/types";

type FileShape = {
  slates: Record<string, Slate>;
};

export function dataDir(): string {
  return process.env.DATA_DIR || path.join(process.cwd(), "data");
}

export function createFileStore(root = dataDir()): Store {
  const file = path.join(root, "store.json");
  const cacheRoot = path.join(root, "cache");
  let chain: Promise<unknown> = Promise.resolve();

  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    const run = chain.then(task, task);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  const readSlates = async (): Promise<FileShape> => {
    try {
      const text = await readFile(file, "utf8");
      const parsed = JSON.parse(text) as FileShape;
      return { slates: parsed.slates ?? {} };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { slates: {} };
      throw error;
    }
  };

  const writeSlates = async (shape: FileShape) => {
    await mkdir(root, { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(shape));
    await rename(temp, file);
  };

  return {
    getSlate: (date) => enqueue(async () => (await readSlates()).slates[date] ?? null),
    putSlate: (slate) =>
      enqueue(async () => {
        const shape = await readSlates();
        shape.slates[slate.slateDate] = slate;
        await writeSlates(shape);
      }),
    listSlates: () =>
      enqueue(async () =>
        Object.values((await readSlates()).slates).sort((a, b) => b.slateDate.localeCompare(a.slateDate)),
      ),
    getCache: (key) =>
      enqueue(async () => {
        try {
          const text = await readFile(cacheFile(cacheRoot, key), "utf8");
          return JSON.parse(text) as CacheEntry;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
          throw error;
        }
      }),
    putCache: (key, body, fetchedAt) =>
      enqueue(async () => {
        await mkdir(cacheRoot, { recursive: true });
        const target = cacheFile(cacheRoot, key);
        const temp = `${target}.${process.pid}.tmp`;
        await writeFile(temp, JSON.stringify({ body, fetchedAt } satisfies CacheEntry));
        await rename(temp, target);
      }),
  };
}

function cacheFile(cacheRoot: string, key: string): string {
  const safe = key.replace(/[^a-z0-9:_-]/gi, "_");
  return path.join(cacheRoot, `${safe}.json`);
}
