// Persistence boundary. The MVP stores the user's own data in the browser; a
// server database can be added later by implementing this interface (e.g. an
// adapter that calls API routes) without touching the UI or the store.
// There is no demo or sample data: a new user starts with an empty account.
import type { AppState } from "../types";

export interface StorageAdapter {
  readonly kind: "browser" | "remote";
  load(): Promise<AppState | null>;
  save(state: AppState): Promise<void>;
  clear(): Promise<void>;
}

export function browserStorage(key: string): StorageAdapter {
  return {
    kind: "browser",
    async load() {
      try {
        const raw = localStorage.getItem(key);
        return raw ? (JSON.parse(raw) as AppState) : null;
      } catch {
        return null; // private mode / blocked storage — app still works in memory
      }
    },
    async save(state) {
      try {
        localStorage.setItem(key, JSON.stringify(state));
      } catch {
        /* quota or blocked storage: keep working in memory */
      }
    },
    async clear() {
      try {
        localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
    },
  };
}

export const USER_KEY = "subscan:v1";

/** Keys used by earlier builds for demo mode. Deleted on load. */
const LEGACY_KEYS = ["subscan:demo", "subscan:mode"];

export function purgeLegacyKeys() {
  try {
    for (const k of LEGACY_KEYS) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}
