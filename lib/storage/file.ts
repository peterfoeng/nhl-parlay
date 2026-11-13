import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Slate, TrackedMulti } from "@/lib/types";
import type { CacheEntry, Store } from "@/lib/storage/types";

type FileShape = {
  slates: Record<string, Slate>;
  multis: Record<string, TrackedMulti>;
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

  const readShape = async (): Promise<FileShape> => {
    try {
      const text = await readFile(file, "utf8");
      const parsed = JSON.parse(text) as Partial<FileShape>;
      return { slates: parsed.slates ?? {}, multis: parsed.multis ?? {} };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { slates: {}, multis: {} };
      throw error;
    }
  };

  const writeShape = async (shape: FileShape) => {
    await mkdir(root, { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(shape));
    await rename(temp, file);
  };

  const listMultis = (shape: FileShape, slateDate?: string) =>
    Object.values(shape.multis)
      .filter((multi) => (slateDate ? multi.slateDate === slateDate : true))
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt));

  return {
    getSlate: (date) => enqueue(async () => (await readShape()).slates[date] ?? null),
    putSlate: (slate) =>
      enqueue(async () => {
        const shape = await readShape();
        shape.slates[slate.slateDate] = slate;
        await writeShape(shape);
      }),
    listSlates: () =>
      enqueue(async () =>
        Object.values((await readShape()).slates).sort((a, b) => b.slateDate.localeCompare(a.slateDate)),
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
    listTrackedMultis: (slateDate) => enqueue(async () => listMultis(await readShape(), slateDate)),
    getTrackedMulti: (id) => enqueue(async () => (await readShape()).multis[id] ?? null),
    putTrackedMulti: (multi) =>
      enqueue(async () => {
        const shape = await readShape();
        shape.multis[multi.id] = multi;
        await writeShape(shape);
      }),
    deleteTrackedMulti: (id) =>
      enqueue(async () => {
        const shape = await readShape();
        delete shape.multis[id];
        await writeShape(shape);
      }),
  };
}

function cacheFile(cacheRoot: string, key: string): string {
  const safe = key.replace(/[^a-z0-9:_-]/gi, "_");
  return path.join(cacheRoot, `${safe}.json`);
}
