"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Missing } from "@/components/empty";
import { ActivityRows } from "@/components/money";
import { RuleForm } from "@/components/rule-form";
import { Icon, PageBar } from "@/components/ui";
import { useStore } from "@/lib/db/store";
import { syncPolicy } from "@/lib/money/policy";
import { evaluateRule, KIND_TEXT, ruleSummary, type RuleNeed } from "@/lib/money/rules";
import { accessState, liveRate, nextCheck, readBalances } from "@/lib/money/runner";

const when = (iso?: string) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");

export default function RuleDetail() {
  const { id } = useParams<{ id: string }>();
  const store = useStore();
  const { state, ready } = store;
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [now, setNow] = useState<RuleNeed | null>(null);
  const [err, setErr] = useState<string>();
  const rule = state.rules.find((r) => r.id === id);

  useEffect(() => {
    if (!ready || !rule) return;
    Promise.all([readBalances(state), liveRate()]).then(([b, r]) => setNow(b ? evaluateRule(rule, b, r) : { kind: "wait", reason: accessState(state) === "none" ? "subscan needs access to your payment wallet to check this rule." : "Balances unavailable right now." }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, rule?.updatedAt, rule?.status]);

  if (!ready) return null;
  if (!rule) return <Missing what="rule" back="/rules" backLabel="Back to money rules" />;
  const history = state.activity.filter((a) => a.ruleId === rule.id);
  const save = async (r: typeof rule) => {
    store.upsertRule(r);
    if (r.kind === "transfer_cap") await syncPolicy(store).catch((e) => setErr(`Saved here, but the server's limit couldn't be updated: ${(e as Error).message}`));
  };

  return (
    <div className="mx-auto max-w-[760px] lg:mx-0">
      <div className="px-4 pt-4 text-[13px] sm:px-6 lg:px-8 lg:pt-8"><Link href="/rules" className="inline-flex items-center gap-1 text-muted hover:text-ink"><Icon name="back" size={15} />money rules</Link></div>
      <PageBar title={<span>{rule.name}</span>} sub={KIND_TEXT[rule.kind].title} />
      <div className="space-y-5 px-4 pb-10 sm:px-6 lg:px-8">
        {err && <p className="callout callout-red block text-[13px]" role="alert">{err}</p>}
        {editing ? (
          <RuleForm initial={rule} onCancel={() => setEditing(false)} onSave={async (r) => { await save(r); setEditing(false); }} />
        ) : (
          <>
            <section className="panel">
              <div className="px-4 py-3.5 text-[14.5px] font-medium">{ruleSummary(rule)}</div>
              <dl className="rows border-t rule text-[13.5px]">
                <Row k="Status">{rule.status === "active" ? <span className="pill pill-green">Active</span> : <span className="pill">Paused</span>}</Row>
                {rule.kind !== "transfer_cap" && <Row k="Largest conversion">{rule.maxAmount ? `${Number(rule.maxAmount).toLocaleString("en-US")} ${rule.fromToken === "USDT" ? "USD₮" : "cNGN"}` : "No extra limit"}</Row>}
                {rule.kind !== "transfer_cap" && <Row k="Before converting">{rule.askFirst ? "Asks you first" : "Converts automatically"}</Row>}
                <Row k="Last run">{rule.lastRunAt ? `${when(rule.lastRunAt)} · ${rule.lastOutcome ?? ""}` : "Not yet"}</Row>
                {rule.kind !== "transfer_cap" && <Row k="Next check">{rule.status !== "active" ? "Paused" : accessState(state) !== "on" ? "When automation is on" : `${when(nextCheck(rule.lastCheckedAt)) === "—" ? "When subscan is next open" : `${when(nextCheck(rule.lastCheckedAt))}, if subscan is open`}`}</Row>}
              </dl>
            </section>

            {now && rule.kind !== "transfer_cap" && (
              <p className={`callout block text-[13.5px] ${now.kind === "convert" ? "callout-amber" : "callout-sage"}`}><span className="font-semibold">Right now: </span>{now.reason}</p>
            )}

            <div className="flex flex-wrap gap-2">
              <button className="btn btn-ghost" onClick={() => save({ ...rule, status: rule.status === "active" ? "paused" : "active", updatedAt: new Date().toISOString() })}>{rule.status === "active" ? "Pause" : "Resume"}</button>
              <button className="btn btn-ghost" onClick={() => setEditing(true)}>Edit</button>
              {!confirmDelete ? (
                <button className="btn btn-quiet text-alert" onClick={() => setConfirmDelete(true)}>Delete</button>
              ) : (
                <span className="flex items-center gap-2 text-[13px]">Delete this rule?<button className="btn btn-danger btn-sm" onClick={async () => { store.removeRule(rule.id); if (rule.kind === "transfer_cap") await syncPolicy(store).catch(() => {}); router.push("/rules"); }}>Delete</button><button className="btn btn-quiet btn-sm" onClick={() => setConfirmDelete(false)}>Keep</button></span>
              )}
            </div>

            <section>
              <h2 className="section-title mb-2 px-1">history</h2>
              <div className="panel">{history.length ? <ActivityRows items={history} /> : <p className="px-4 py-4 text-[13px] text-muted">{rule.kind === "transfer_cap" ? "This rule blocks transfers above its limit. Blocked transfers show in activity." : "No conversions yet."}</p>}</div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-4 px-4 py-2.5"><dt className="text-muted">{k}</dt><dd className="text-right">{children}</dd></div>;
}
