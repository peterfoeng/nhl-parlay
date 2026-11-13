import type { Slate, TrackedMulti } from "@/lib/types";

export type CacheEntry = {
  body: string;
  fetchedAt: string;
};

export type Store = {
  getSlate(date: string): Promise<Slate | null>;
  putSlate(slate: Slate): Promise<void>;
  listSlates(): Promise<Slate[]>;
  getCache(key: string): Promise<CacheEntry | null>;
  putCache(key: string, body: string, fetchedAt: string): Promise<void>;
  listTrackedMultis(slateDate?: string): Promise<TrackedMulti[]>;
  getTrackedMulti(id: string): Promise<TrackedMulti | null>;
  putTrackedMulti(multi: TrackedMulti): Promise<void>;
  deleteTrackedMulti(id: string): Promise<void>;
};
