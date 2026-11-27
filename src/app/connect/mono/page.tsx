"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Wordmark } from "@/components/shell";
import { useStore } from "@/lib/db/store";

interface LinkRow { ref: string; account_id: string | null; status: string; last_synced_at: string | null; last_error: string | null }

const LABEL: Record<string, string> = {
  initiated: "Waiting for Mono to confirm the link…",
  connected: "Account linked. Mono is fetching your transactions…",
  available: "Transactions ready — importing…",
  partial: "Some data available — importing…",
  synced: "Imported. Subscriptions detected.",
  unavailable: "Your bank didn’t return transaction data. Try again later or import a CSV.",
  failed: "Mono couldn’t fetch data for this account. Try again later or import a CSV.",
};

export default function MonoReturn() {
  const { reload } = useStore();
  const [link, setLink] = useState<LinkRow | null>(null);
  const [err, setErr] = useState<string>();
  const [elapsed, setElapsed] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const done = useRef(false);

  useEffect(() => {
    const ref = new URLSearchParams(window.location.search).get("ref");
    let n = 0;
    const tick = async () => {
      try {
        const j = await fetch("/api/mono/status").then((r) => r.json());
        if (j.error) throw new Error(j.error);
        const l = (j.data.links as LinkRow[]).find((x) => !ref || x.ref === ref) ?? null;
        setLink(l);
        if (l?.status === "synced" && !done.current) {
          done.current = true;
          await reload();
        }
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    };
    void tick();
    const t = setInterval(() => {
      n += 4;
      setElapsed(n);
      if (!done.current && n < 300) void tick();
    }, 4000);
    return () => clearInterval(t);
  }, [reload]);

  async function syncNow() {
    setSyncing(true);
    setErr(undefined);
    const r = await fetch("/api/mono/sync", { method: "POST" });
    const j = await r.json();
    setSyncing(false);
    if (!r.ok) return setErr(j.error);
    done.current = true;
    setLink((l) => (l ? { ...l, status: "synced" } : l));
    await reload();
  }

  const status = link?.status ?? "initiated";
  const terminal = ["synced", "unavailable", "failed"].includes(status);
  return (
    <div className="min-h-dvh">
      <div className="border-b rule px-4 py-5 sm:px-8 lg:px-12"><Wordmark /></div>
      <div className="mx-auto max-w-xl px-4 py-16 sm:px-8">
        <div className="kicker mb-4">Bank connection · Mono</div>
        <h1 className="display text-[40px]">{status === "synced" ? "Your bank is connected." : terminal ? "We couldn’t import your data." : "Connecting your bank…"}</h1>
        <p className="mt-4 text-[15px] text-ink-2" aria-live="polite">{LABEL[status] ?? status}</p>
        {!terminal && <div className="mt-6 h-[3px] w-full overflow-hidden bg-stone"><div className="h-full w-1/3 animate-pulse bg-accent" /></div>}
        {link?.last_error && <p className="mt-4 text-[13px] text-alert">{link.last_error}</p>}
        {err && <p className="mt-4 text-[13px] text-alert">{err}</p>}
        <div className="mt-10 flex flex-wrap gap-3">
          {status === "synced" && <Link href="/" className="btn btn-primary">See your subscriptions</Link>}
          {link?.account_id && status !== "synced" && <button className="btn btn-primary" disabled={syncing} onClick={syncNow}>{syncing ? "Importing…" : "Import now"}</button>}
          <Link href="/onboarding" className="btn btn-ghost">Import a CSV instead</Link>
        </div>
        {!terminal && elapsed > 60 && !link?.account_id && <p className="mt-6 text-[12px] text-muted">Still waiting for Mono&rsquo;s confirmation. If you closed the Mono window before finishing, start again from onboarding.</p>}
      </div>
    </div>
  );
}
