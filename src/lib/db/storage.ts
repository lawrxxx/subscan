// Persistence boundary. The MVP stores everything in the browser; a server
// database can be added later by implementing this interface (e.g. an adapter
// that calls API routes) without touching the UI or the store.
import type { AppState } from "../types";

export interface StorageAdapter {
  readonly kind: "browser" | "remote";
  load(): Promise<AppState | null>;
  save(state: AppState): Promise<void>;
  clear(): Promise<void>;
}

const KEY = "subscan:v1";

export const browserStorage: StorageAdapter = {
  kind: "browser",
  async load() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? (JSON.parse(raw) as AppState) : null;
    } catch {
      return null; // private mode / blocked storage — app still works in memory
    }
  },
  async save(state) {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* quota or blocked storage: keep working in memory */
    }
  },
  async clear() {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  },
};
