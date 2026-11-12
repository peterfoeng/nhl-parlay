import { createFileStore } from "@/lib/storage/file";
import { createPostgresStore } from "@/lib/storage/postgres";
import type { Store } from "@/lib/storage/types";

let store: Store | null = null;

export function getStore(): Store {
  if (store) return store;
  store = process.env.DATABASE_URL ? createPostgresStore() : createFileStore();
  return store;
}

export function resetStoreForTests(): void {
  store = null;
}
