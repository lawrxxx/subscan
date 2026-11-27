// Persistence boundary. The MVP stores everything in the browser; a server
// database can be added later by implementing this interface (e.g. an adapter
// that calls API routes) without touching the UI or the store.
//
// Two workspaces are kept strictly apart:
//   - "user": the person's own imported statements, bills and payment records.
//   - "demo": a generated sample statement for exploring the product.
// Demo data is never written to, read from, or merged with the user workspace.
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
export const DEMO_KEY = "subscan:demo";
export const MODE_KEY = "subscan:mode";

export function readMode(): "user" | "demo" {
  try {
    return localStorage.getItem(MODE_KEY) === "demo" ? "demo" : "user";
  } catch {
    return "user";
  }
}

export function writeMode(mode: "user" | "demo") {
  try {
    if (mode === "demo") localStorage.setItem(MODE_KEY, "demo");
    else localStorage.removeItem(MODE_KEY);
  } catch {
    /* ignore */
  }
}
