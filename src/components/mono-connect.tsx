"use client";
import { useEffect, useState } from "react";
import { useStore } from "@/lib/db/store";

/** "Connect a bank" card. Real Mono linking only — never shows a fake connection. */
export function MonoConnect() {
  const { mode } = useStore();
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();

  useEffect(() => {
    fetch("/api/status").then((r) => r.json()).then((j) => setConfigured(!!j.data?.mono)).catch(() => setConfigured(false));
  }, []);

  const available = mode === "account" && configured === true;
  const reason =
    mode !== "account" ? "Sign-in is required to link a bank account." : configured === false ? "Bank linking isn’t enabled on this deployment yet. Import a CSV instead." : configured === null ? "Checking availability…" : "Securely link a Nigerian bank account through Mono. subscan reads transactions only — it can’t move money.";

  async function start() {
    setBusy(true);
    setErr(undefined);
    try {
      const r = await fetch("/api/mono/initiate", { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Could not start linking");
      window.location.href = j.data.url;
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div className="px-6 py-5">
      <div className={`flex items-center gap-2 text-[14px] font-medium ${available ? "" : "text-muted"}`}>
        Connect a bank via Mono {!available && configured !== null && <span className="tag">Unavailable</span>}
      </div>
      <div className="mt-1 text-[13px] text-muted">{reason}</div>
      {available && <button className="btn btn-primary mt-4 h-9" disabled={busy} onClick={start}>{busy ? "Opening Mono…" : "Link bank account"}</button>}
      {err && <p className="mt-2 text-[12px] text-alert">{err}</p>}
    </div>
  );
}
