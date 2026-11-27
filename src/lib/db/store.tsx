"use client";
// Application state: subscriptions, imported transactions, payment records and
// preferences. Persisted through a StorageAdapter (browser localStorage today).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { detectSubscriptions, mergeWithPrevious } from "../detection/engine";
import { extractCsv } from "../import/csv";
import { mergeTransactions, rowsToTransactions } from "../import/normalise";
import type { ExtractedRow } from "../import/types";
import { sampleStatementCsv } from "../sample";
import type { AppSettings, AppState, ImportRecord, PaymentRecord, Subscription } from "../types";
import { browserStorage, DEMO_KEY, readMode, USER_KEY, writeMode, type StorageAdapter } from "./storage";

const EMPTY: AppState = {
  transactions: [],
  subscriptions: [],
  payments: [],
  settings: { homeCurrency: "NGN", payGasInUsdt: false },
};

/** "Lapsed" depends on today's date, so it is recomputed on every load. */
function withLapsed(subs: Subscription[]): Subscription[] {
  const now = Date.now();
  return subs.map((s) => ({ ...s, lapsed: !s.manual && (now - Date.parse(`${s.lastCharge}T00:00:00Z`)) / 86_400_000 > s.intervalDays * 2.2 }));
}

export type Workspace = "user" | "demo";

interface Store {
  ready: boolean;
  storage: StorageAdapter["kind"];
  /** Which workspace is showing. Demo data never touches the user's own data. */
  mode: Workspace;
  state: AppState;
  /** Open the demo workspace with a fresh sample statement (the user's data is untouched). */
  enterDemo(): void;
  exitDemo(): void;
  /** Save reviewed rows: de-duplicate against existing data, then re-run detection. */
  importRows(rows: ExtractedRow[], meta: { fileName: string; format: string; source: "csv" | "pdf" | "sample" }): { record: ImportRecord; subscriptions: Subscription[] };
  removeImport(importId: string): void;
  addManual(sub: Subscription): void;
  removeSubscription(id: string): void;
  updateSubscription(id: string, patch: Partial<Subscription>): void;
  updateSettings(patch: Partial<AppSettings>): void;
  upsertPayment(p: PaymentRecord): void;
  removePayment(id: string): void;
  reset(): void;
}

const Ctx = createContext<Store | null>(null);

function hydrate(saved: AppState | null): AppState {
  if (!saved) return EMPTY;
  return { ...EMPTY, ...saved, subscriptions: withLapsed(saved.subscriptions ?? []), settings: { ...EMPTY.settings, ...saved.settings } };
}

/**
 * Older versions kept the sample statement in the same slot as real data.
 * Strip it out so a sample is never presented as the user's own finances.
 * Preferences and records of real payments are kept.
 */
function withoutLegacySample(s: AppState): AppState {
  if (s.dataSource !== "sample") return s;
  return { ...EMPTY, settings: s.settings, payments: s.payments.filter((p) => p.status !== "prepared") };
}

export function StoreProvider({ children, userAdapter = browserStorage(USER_KEY), demoAdapter = browserStorage(DEMO_KEY) }: { children: ReactNode; userAdapter?: StorageAdapter; demoAdapter?: StorageAdapter }) {
  const [mode, setMode] = useState<Workspace>("user");
  const [state, setState] = useState<AppState>(EMPTY);
  const [ready, setReady] = useState(false);
  const ref = useRef(state);
  ref.current = state;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const adapter = mode === "demo" ? demoAdapter : userAdapter;

  useEffect(() => {
    let live = true;
    const m = readMode();
    Promise.all([userAdapter.load(), demoAdapter.load()]).then(([user, demo]) => {
      if (!live) return;
      let u = hydrate(user);
      const cleaned = withoutLegacySample(u);
      if (cleaned !== u) {
        u = cleaned;
        void userAdapter.save(u);
      }
      const useDemo = m === "demo" && !!demo;
      setMode(useDemo ? "demo" : "user");
      setState(useDemo ? hydrate(demo) : u);
      setReady(true);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Apply a change to the active workspace and persist it to that workspace only. */
  const commit = useCallback(
    (fn: (s: AppState) => AppState) => {
      const next = fn(ref.current);
      ref.current = next;
      setState(next);
      void (modeRef.current === "demo" ? demoAdapter : userAdapter).save(next);
    },
    [demoAdapter, userAdapter],
  );

  /** Switch workspaces synchronously from what is already stored. */
  const switchTo = useCallback(
    async (m: Workspace, demoState?: AppState) => {
      const next = m === "demo" ? (demoState ?? hydrate(await demoAdapter.load())) : hydrate(await userAdapter.load());
      if (demoState) await demoAdapter.save(demoState);
      writeMode(m);
      modeRef.current = m;
      ref.current = next;
      setMode(m);
      setState(next);
    },
    [demoAdapter, userAdapter],
  );

  const store = useMemo<Store>(() => {
    const redetect = (txs: AppState["transactions"], previous: Subscription[]) => {
      const fresh = detectSubscriptions(txs, { homeCurrency: ref.current.settings.homeCurrency });
      return mergeWithPrevious(fresh, previous);
    };
    const importRows: Store["importRows"] = (rows, meta) => {
      const cur = ref.current;
      if (meta.source !== "sample" && modeRef.current === "demo") {
        throw new Error("Exit demo mode before importing your own statement.");
      }
      const id = `imp_${Date.now().toString(36)}`;
      const incoming = rowsToTransactions(rows, meta.source, id);
      // The demo workspace is regenerated rather than merged.
      const replacing = meta.source === "sample";
      const base = replacing ? [] : cur.transactions;
      const { merged, added, duplicates } = mergeTransactions(base, incoming);
      const subs = redetect(merged, replacing ? cur.subscriptions.filter((x) => x.manual) : cur.subscriptions);
      const dates = incoming.map((t) => t.date).sort();
      const record: ImportRecord = { id, at: new Date().toISOString(), fileName: meta.fileName, format: meta.format, rows: added, duplicates, from: dates[0], to: dates[dates.length - 1] };
      commit((s) => ({
        ...s,
        transactions: merged,
        subscriptions: subs,
        importedAt: record.at,
        dataSource: meta.source,
        imports: [record, ...(replacing ? [] : (s.imports ?? []))].slice(0, 20),
      }));
      return { record, subscriptions: subs };
    };
    return {
      ready,
      storage: adapter.kind,
      mode,
      state,
      importRows,
      enterDemo() {
        // Build the demo workspace from a freshly generated sample statement.
        const settings = ref.current.settings;
        const r = extractCsv(sampleStatementCsv(), settings.homeCurrency);
        const id = `demo_${Date.now().toString(36)}`;
        const txs = rowsToTransactions(r.rows, "sample", id);
        const subs = detectSubscriptions(txs, { homeCurrency: settings.homeCurrency });
        const dates = txs.map((t) => t.date).sort();
        const demo: AppState = {
          ...EMPTY,
          settings: { ...settings, wallet: undefined, agentId: undefined, agentRegistrationTx: undefined },
          transactions: txs,
          subscriptions: subs,
          importedAt: new Date().toISOString(),
          dataSource: "sample",
          imports: [{ id, at: new Date().toISOString(), fileName: "Demo sample statement", format: "CSV", rows: txs.length, duplicates: 0, from: dates[0], to: dates[dates.length - 1] }],
        };
        void switchTo("demo", demo);
      },
      exitDemo() {
        void demoAdapter.clear();
        void switchTo("user");
      },
      removeImport(importId) {
        const cur = ref.current;
        const txs = cur.transactions.filter((t) => !t.id.startsWith(`${importId}-`));
        const subs = redetect(txs, cur.subscriptions);
        commit((s) => ({ ...s, transactions: txs, subscriptions: subs, imports: (s.imports ?? []).filter((i) => i.id !== importId) }));
      },
      removeSubscription(id) {
        commit((s) => ({ ...s, subscriptions: s.subscriptions.filter((x) => x.id !== id || !x.manual) }));
      },
      addManual(sub) {
        commit((s) => ({ ...s, subscriptions: [...s.subscriptions.filter((x) => x.id !== sub.id), sub] }));
      },
      updateSubscription(id, patch) {
        commit((s) => ({ ...s, subscriptions: s.subscriptions.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
      },
      updateSettings(patch) {
        commit((s) => ({ ...s, settings: { ...s.settings, ...patch } }));
      },
      upsertPayment(p) {
        commit((s) => {
          const exists = s.payments.some((x) => x.id === p.id);
          // Never downgrade a confirmed on-chain record.
          if (exists && s.payments.find((x) => x.id === p.id)!.status === "confirmed" && p.status !== "confirmed") return s;
          return { ...s, payments: exists ? s.payments.map((x) => (x.id === p.id ? p : x)) : [p, ...s.payments] };
        });
      },
      removePayment(id) {
        commit((s) => ({ ...s, payments: s.payments.filter((x) => x.id !== id || x.status !== "prepared") }));
      },
      reset() {
        // Keep preferences and records of on-chain payments; drop imports and drafts.
        commit((s) => ({ ...EMPTY, settings: s.settings, payments: s.payments.filter((p) => p.status !== "prepared") }));
      },
    };
  }, [ready, adapter.kind, mode, state, commit, switchTo, demoAdapter]);

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useStore() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore outside StoreProvider");
  return s;
}

/** Live indicative USD→NGN rate from Textile FX, used only to total mixed-currency spend. */
export function useRates(home: string) {
  const [rates, setRates] = useState<Record<string, number>>({});
  const [meta, setMeta] = useState<{ asOf?: string; error?: string }>({});
  useEffect(() => {
    if (home !== "NGN") return;
    let cancelled = false;
    fetch("/api/fx/rate")
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (j.data) {
          setRates({ USD: j.data.ngnPerUsd });
          setMeta({ asOf: j.data.asOf });
        } else setMeta({ error: j.error });
      })
      .catch((e) => !cancelled && setMeta({ error: String(e) }));
    return () => {
      cancelled = true;
    };
  }, [home]);
  return { rates, ...meta };
}
