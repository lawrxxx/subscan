"use client";
// Application state: the user's imported transactions, detected bills, payment
// records, agent actions and preferences. Persisted through a StorageAdapter
// (browser localStorage). Nothing is ever seeded — a new user starts empty.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { detectSubscriptions, mergeWithPrevious } from "../detection/engine";
import { mergeTransactions, rowsToTransactions } from "../import/normalise";
import type { ExtractedRow } from "../import/types";
import type { AgentAction, AppSettings, AppState, ImportRecord, PaymentRecord, Subscription } from "../types";
import { browserStorage, purgeLegacyKeys, USER_KEY, type StorageAdapter } from "./storage";

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

/** Test fixture subscan once published for mainnet testing — never treated as user finances. */
const FIXTURE_FILES = new Set(["test-merchant.csv"]);
const FIXTURE_NARRATION = /^TEST MERCHANT MONTHLY PLAN$/i;

/**
 * Remove anything that isn't the user's own data:
 *  - sample/demo statements stored by older builds,
 *  - the published test-merchant fixture and bills derived from it.
 * Records of real payments and preferences are always kept.
 */
export function sanitize(s: AppState): AppState {
  if (s.dataSource === "sample") return { ...EMPTY, settings: s.settings, payments: s.payments.filter((p) => p.status !== "prepared"), actions: s.actions };
  const fixtureImports = new Set((s.imports ?? []).filter((i) => FIXTURE_FILES.has(i.fileName)).map((i) => i.id));
  const isFixtureTx = (t: AppState["transactions"][number]) => t.source === "sample" || FIXTURE_NARRATION.test(t.description) || [...fixtureImports].some((id) => t.id.startsWith(`${id}-`));
  const transactions = s.transactions.filter((t) => !isFixtureTx(t));
  if (transactions.length === s.transactions.length && fixtureImports.size === 0) return s;
  const removedMerchants = new Set(s.transactions.filter(isFixtureTx).map((t) => t.merchant));
  return {
    ...s,
    transactions,
    subscriptions: s.subscriptions.filter((x) => x.manual || !removedMerchants.has(x.merchant)),
    imports: (s.imports ?? []).filter((i) => !fixtureImports.has(i.id)),
    dataSource: transactions.length ? s.dataSource : undefined,
  };
}

interface Store {
  ready: boolean;
  storage: StorageAdapter["kind"];
  state: AppState;
  /** Save reviewed rows: de-duplicate against existing data, then re-run detection. */
  importRows(rows: ExtractedRow[], meta: { fileName: string; format: string; source: "csv" | "pdf" }): { record: ImportRecord; subscriptions: Subscription[] };
  removeImport(importId: string): void;
  addManual(sub: Subscription): void;
  removeSubscription(id: string): void;
  updateSubscription(id: string, patch: Partial<Subscription>): void;
  updateSettings(patch: Partial<AppSettings>): void;
  upsertPayment(p: PaymentRecord): void;
  removePayment(id: string): void;
  logAction(a: Omit<AgentAction, "id" | "at">): void;
  reset(): void;
}

const Ctx = createContext<Store | null>(null);

function hydrate(saved: AppState | null): AppState {
  if (!saved) return EMPTY;
  return { ...EMPTY, ...saved, subscriptions: withLapsed(saved.subscriptions ?? []), settings: { ...EMPTY.settings, ...saved.settings } };
}

export function StoreProvider({ children, adapter: given }: { children: ReactNode; adapter?: StorageAdapter }) {
  // One adapter for the provider's lifetime — a new one each render would re-run the load effect forever.
  const [adapter] = useState<StorageAdapter>(() => given ?? browserStorage(USER_KEY));
  const [state, setState] = useState<AppState>(EMPTY);
  const [ready, setReady] = useState(false);
  const ref = useRef(state);
  ref.current = state;

  useEffect(() => {
    let live = true;
    purgeLegacyKeys();
    adapter.load().then((saved) => {
      if (!live) return;
      const loaded = hydrate(saved);
      const clean = sanitize(loaded);
      if (clean !== loaded) void adapter.save(clean);
      setState(clean);
      setReady(true);
    });
    return () => {
      live = false;
    };
  }, [adapter]);

  const commit = useCallback(
    (fn: (s: AppState) => AppState) => {
      const next = fn(ref.current);
      ref.current = next;
      setState(next);
      void adapter.save(next);
    },
    [adapter],
  );

  const store = useMemo<Store>(() => {
    const redetect = (txs: AppState["transactions"], previous: Subscription[]) => mergeWithPrevious(detectSubscriptions(txs, { homeCurrency: ref.current.settings.homeCurrency }), previous);
    return {
      ready,
      storage: adapter.kind,
      state,
      importRows(rows, meta) {
        const cur = ref.current;
        const id = `imp_${Date.now().toString(36)}`;
        const incoming = rowsToTransactions(rows, meta.source, id);
        const { merged, added, duplicates } = mergeTransactions(cur.transactions, incoming);
        const subs = redetect(merged, cur.subscriptions);
        const dates = incoming.map((t) => t.date).sort();
        const record: ImportRecord = { id, at: new Date().toISOString(), fileName: meta.fileName, format: meta.format, rows: added, duplicates, from: dates[0], to: dates[dates.length - 1] };
        commit((s) => ({ ...s, transactions: merged, subscriptions: subs, importedAt: record.at, dataSource: meta.source, imports: [record, ...(s.imports ?? [])].slice(0, 30) }));
        return { record, subscriptions: subs };
      },
      removeImport(importId) {
        const cur = ref.current;
        const txs = cur.transactions.filter((t) => !t.id.startsWith(`${importId}-`));
        commit((s) => ({ ...s, transactions: txs, subscriptions: redetect(txs, cur.subscriptions.filter((x) => x.manual || x.status !== "detected")), imports: (s.imports ?? []).filter((i) => i.id !== importId) }));
      },
      addManual(sub) {
        commit((s) => ({ ...s, subscriptions: [...s.subscriptions.filter((x) => x.id !== sub.id), sub] }));
      },
      removeSubscription(id) {
        commit((s) => ({ ...s, subscriptions: s.subscriptions.filter((x) => x.id !== id || !x.manual) }));
      },
      updateSubscription(id, patch) {
        commit((s) => ({ ...s, subscriptions: s.subscriptions.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
      },
      updateSettings(patch) {
        commit((s) => ({ ...s, settings: { ...s.settings, ...patch } }));
      },
      upsertPayment(p) {
        commit((s) => {
          const existing = s.payments.find((x) => x.id === p.id);
          // Never downgrade a confirmed on-chain record.
          if (existing?.status === "confirmed" && p.status !== "confirmed") return s;
          return { ...s, payments: existing ? s.payments.map((x) => (x.id === p.id ? p : x)) : [p, ...s.payments] };
        });
      },
      removePayment(id) {
        commit((s) => ({ ...s, payments: s.payments.filter((x) => x.id !== id || x.status !== "prepared") }));
      },
      logAction(a) {
        commit((s) => ({ ...s, actions: [{ ...a, id: `act_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, at: new Date().toISOString() }, ...(s.actions ?? [])].slice(0, 100) }));
      },
      reset() {
        // Keep preferences and records of on-chain payments; drop imports, bills and drafts.
        commit((s) => ({ ...EMPTY, settings: s.settings, payments: s.payments.filter((p) => p.status !== "prepared") }));
      },
    };
  }, [ready, adapter.kind, state, commit]);

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
