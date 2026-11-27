"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { TOKENS } from "@/lib/celo/config";
import { useStore } from "@/lib/db/store";
import { date, money } from "@/lib/format";
import type { AppState } from "@/lib/types";
import { Markdown } from "@/components/bits";
import { EmptyPanel, PageBar, UploadButton } from "@/components/ui";

interface Trace { name: string; input: Record<string, unknown>; result: unknown; error?: boolean }
interface Evidence { bills: { id: string; name: string }[]; transactions: { date: string; description: string; amount: number; currency: string; direction: string }[] }
interface Turn { role: "user" | "assistant"; content: string; trace?: Trace[]; evidence?: Evidence; model?: string; error?: boolean; retry?: string }

const PROMPTS = [
  "How much do I spend every month?",
  "What payments are coming up?",
  "Where does most of my money go?",
  "Am I paying for anything twice?",
  "Where could I save money?",
];

const TOOL_LABEL: Record<string, string> = {
  list_subscriptions: "Your regular payments",
  get_subscription: "One payment's history",
  spending_analysis: "Your monthly totals",
  upcoming_renewals: "Payments coming up",
  find_waste: "Possible savings",
  check_wallet_balance: "Your wallet balance",
  prepare_payment: "A payment draft",
  transaction_status: "Payment status",
  propose_subscription_changes: "Suggested changes",
  search_transactions: "Matching transactions",
  spending_breakdown: "Spending by category",
  income_and_payday: "Your income and payday",
  savings_analysis: "Possible savings",
};

type Availability = { available: boolean; model?: string } | null;

// The agent gets structured data only — never the statement file. Transactions are
// trimmed to the fields its tools use and the most recent 2,000 rows.
function snapshot(state: AppState): AppState {
  return {
    ...state,
    imports: undefined,
    transactions: state.transactions.slice(-2000).map((t) => ({ id: t.id, date: t.date, description: t.description, merchant: t.merchant, amount: t.amount, currency: t.currency, direction: t.direction, source: t.source })),
    subscriptions: state.subscriptions.map((s) => ({ ...s, history: s.history.slice(-12) })),
  };
}

export default function Ask() {
  const { state, ready, updateSubscription, logAction, removePayment } = useStore();
  const [applied, setApplied] = useState<Record<string, boolean>>({});
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [avail, setAvail] = useState<Availability>(null);
  useEffect(() => {
    fetch("/api/agent").then((r) => r.json()).then((j) => setAvail(j.data)).catch(() => setAvail({ available: false }));
  }, []);
  const end = useRef<HTMLDivElement>(null);
  const chat = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (turns.length) end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [turns, busy]);

  async function ask(q: string) {
    const question = q.trim();
    if (!question || busy || avail?.available === false) return;
    const base = turns.length && turns[turns.length - 1].error ? turns.slice(0, -2) : turns;
    const next: Turn[] = [...base, { role: "user", content: question }];
    setTurns(next);
    setInput("");
    setBusy(true);
    if (window.innerWidth < 1280) chat.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    try {
      const r = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next.filter((t) => !t.error).map(({ role, content }) => ({ role, content })), state: snapshot(state) }),
      });
      const j = await r.json();
      if (!r.ok) {
        if (j.code === "unavailable") setAvail({ available: false });
        throw new Error(j.error ?? "Ask subscan isn't available right now.");
      }
      setTurns([...next, { role: "assistant", content: j.data.text, trace: j.data.trace, evidence: j.data.evidence, model: j.data.model }]);
    } catch (e) {
      const msg = e instanceof Error && e.message !== "Failed to fetch" ? e.message : "Couldn't reach subscan. Check your connection and try again.";
      setTurns([...next, { role: "assistant", content: msg, error: true, retry: question }]);
    } finally {
      setBusy(false);
    }
  }

  // Deep links (e.g. "Ask the agent" on the overview) arrive as ?q=…
  const asked = useRef(false);
  useEffect(() => {
    if (!ready || !avail?.available || asked.current || (!state.subscriptions.length && !state.transactions.length)) return;
    const q = new URLSearchParams(window.location.search).get("q");
    if (q) {
      asked.current = true;
      window.history.replaceState(null, "", "/ask");
      void ask(q.slice(0, 300));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, avail, state.subscriptions.length]);

  const drafts = state.payments.filter((p) => p.status === "prepared");
  const toCheck = state.subscriptions.filter((s) => s.status === "detected" && !s.manual).length;

  if (!ready) return null;
  if (!state.subscriptions.length && !state.transactions.length)
    return (
      <div>
        <PageBar title="Ask subscan" sub="Questions about your money, answered from your own statements" />
        <div className="px-4 sm:px-6 lg:px-8">
          <section className="panel">
            <EmptyPanel icon="chat" title="Add a statement first" action={<UploadButton label="Add a statement" />}>subscan answers from your own transactions, so it needs a statement to work with.</EmptyPanel>
          </section>
        </div>
      </div>
    );

  return (
    <div className="flex min-h-[calc(100dvh-120px)] flex-col lg:min-h-dvh">
      <PageBar title="Ask subscan" sub="Answers come from your own statements. Nothing changes until you say so." />

      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 sm:px-6 lg:px-8">
        {drafts.length > 0 && (
          <section className="mb-3 rounded-[6px] border rule bg-surface">
            <div className="px-3 pt-2.5 text-[12.5px] font-medium text-muted">Waiting for your approval</div>
            <ul className="divide-y divide-[var(--color-rule-soft)]">
              {drafts.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2 text-[13.5px]">
                  <span className="min-w-0 truncate">Pay {p.merchant} · <span className="num">{p.destinationAmount} {TOKENS[p.destinationToken].display}</span></span>
                  <span className="flex shrink-0 gap-1.5">
                    <Link href={`/pay/${encodeURIComponent(p.subscriptionId)}`} className="btn btn-primary btn-sm">Review</Link>
                    <button className="btn btn-quiet btn-sm" onClick={() => removePayment(p.id)}>Remove</button>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section ref={chat} className="flex flex-1 flex-col">
          <div className="flex-1 pb-4">
            {avail?.available === false ? (
              <div className="rounded-[6px] bg-paper-2 px-4 py-3 text-[13.5px]">
                <div className="font-medium">Ask subscan isn&rsquo;t available right now</div>
                <p className="mt-1 text-muted">It hasn&rsquo;t been switched on for this site yet. You can still see everything on Home, Payments and Spending.</p>
              </div>
            ) : !turns.length ? (
              <div>
                <p className="text-[14px] text-ink-2">Try one of these:</p>
                <div className="mt-2 flex flex-col gap-1.5 sm:flex-row sm:flex-wrap">
                  {PROMPTS.map((p) => <button key={p} onClick={() => ask(p)} className="rounded-[6px] border rule bg-surface px-3 py-2.5 text-left text-[14px] hover:border-line-strong hover:bg-paper-2 sm:rounded-full sm:py-1.5 sm:text-[13px]">{p}</button>)}
                </div>
                {toCheck > 0 && <p className="mt-4 text-[12.5px] text-muted">Tip: <Link href="/review" className="link">check your {toCheck} suggested payments</Link> first so answers about regular payments are accurate.</p>}
              </div>
            ) : (
              <div className="space-y-4">
                {turns.map((t, i) =>
                  t.role === "user" ? (
                    <div key={i} className="ml-10 rounded-[8px] bg-paper-2 px-3 py-2 text-[14px]">{t.content}</div>
                  ) : (
                    <div key={i}>
                      <div className={`text-[14px] leading-relaxed ${t.error ? "text-alert" : ""}`}><Markdown text={t.content} /></div>
                      {t.error && t.retry && avail?.available !== false && <button className="btn btn-ghost btn-sm mt-2" onClick={() => ask(t.retry!)}>Try again</button>}
                      {(t.trace ?? []).filter((tr) => tr.name === "prepare_payment" && !(tr.result as { error?: string }).error).map((tr, j) => <div key={`d${j}`} className="mt-3"><Draft d={tr.result as DraftResult} /></div>)}
                      {(t.trace ?? [])
                        .map((tr, j) => ({ tr, key: `${i}-${j}` }))
                        .filter(({ tr }) => tr.name === "propose_subscription_changes" && ((tr.result as Proposal).changes?.length ?? 0) > 0)
                        .map(({ tr, key }) => (
                          <ProposalCard
                            key={key}
                            p={tr.result as Proposal}
                            applied={!!applied[key]}
                            onApply={() => {
                              const p = tr.result as Proposal;
                              p.changes.forEach((c) => updateSubscription(c.id, c.patch ?? { status: c.to as "confirmed" | "dismissed" | "detected" }));
                              logAction({ kind: p.action === "confirm" ? "confirmed" : p.action === "dismiss" ? "dismissed" : p.action === "restore" ? "restored" : "recategorised", title: `${p.action === "categorise" ? "Updated" : p.action === "confirm" ? "Confirmed" : p.action === "dismiss" ? "Marked not regular:" : "Moved back to check:"} ${p.changes.length === 1 ? p.changes[0].name : `${p.changes.length} payments`}`, detail: "From Ask subscan" });
                              setApplied((a) => ({ ...a, [key]: true }));
                            }}
                          />
                        ))}
                      {!t.error && (t.evidence?.bills.length || t.evidence?.transactions.length || t.trace?.length) ? <EvidenceList e={t.evidence ?? { bills: [], transactions: [] }} steps={(t.trace ?? []).map((tr) => TOOL_LABEL[tr.name] ?? tr.name)} /> : null}
                    </div>
                  ),
                )}
                {busy && <div className="flex items-center gap-2 text-[13px] text-muted"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />Looking at your transactions…</div>}
                <div ref={end} />
              </div>
            )}
          </div>

          <form
            className="sticky bottom-[calc(57px+env(safe-area-inset-bottom))] -mx-4 border-t rule bg-paper/95 px-4 py-2.5 backdrop-blur sm:-mx-6 sm:px-6 lg:bottom-0 lg:-mx-8 lg:px-8"
            onSubmit={(e) => {
              e.preventDefault();
              void ask(input);
            }}
          >
            <div className="flex gap-2">
              <input className="input flex-1" placeholder={avail?.available === false ? "Not available" : "Ask about your money…"} value={input} onChange={(e) => setInput(e.target.value)} disabled={busy || avail?.available === false} aria-label="Ask subscan a question" />
              <button className="btn btn-primary" disabled={busy || !input.trim() || avail?.available === false}>Ask</button>
            </div>
            {turns.length > 0 && <button type="button" className="mt-1.5 text-[12px] text-muted hover:text-ink" onClick={() => { setTurns([]); setApplied({}); }}>Start over</button>}
          </form>
        </section>
      </div>
    </div>
  );
}

function EvidenceList({ e, steps }: { e: Evidence; steps: string[] }) {
  const [open, setOpen] = useState(false);
  const looked = [...new Set(steps)];
  return (
    <div className="mt-2 text-[12.5px]">
      <button className="text-muted hover:text-ink" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? "Hide" : "Show"} what this is based on
      </button>
      {open && (
        <div className="mt-1.5 rounded-[6px] border rule bg-surface">
          {looked.length > 0 && <p className="px-3 pt-2 text-[12px] text-muted">Looked at: {looked.join(", ")}</p>}
          {e.bills.length > 0 && (
            <div className="flex flex-wrap gap-1 px-3 py-2">
              {e.bills.map((b) => <Link key={b.id} href={`/payments/${encodeURIComponent(b.id)}`} className="tag hover:border-line-strong">{b.name}</Link>)}
            </div>
          )}
          {e.transactions.length > 0 && (
            <ul className={`divide-y divide-[var(--color-rule-soft)] ${e.bills.length ? "border-t rule" : ""}`}>
              {e.transactions.map((t, i) => (
                <li key={i} className="flex justify-between gap-3 px-3 py-1.5">
                  <span className="min-w-0 truncate"><span className="num text-muted">{date(t.date)}</span> · {t.description}</span>
                  <span className={`num shrink-0 ${t.direction === "credit" ? "text-accent" : ""}`}>{t.direction === "credit" ? "+" : "−"}{money(t.amount, t.currency)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

interface DraftResult {
  review_url: string;
  subscription: { name: string; amount: number; currency: string; next_renewal: string };
  plan: { problems: string[]; needsConversion: boolean; sourceToken?: string; destinationToken?: string };
  quote: { pay?: string; receive?: string; rate?: string; fee?: string; error?: string; reason?: string } | null;
  balance: { available?: string; token?: string; sufficient?: boolean | null; error?: string } | null;
}

function Draft({ d }: { d: DraftResult }) {
  return (
    <div className="rounded-[6px] border rule bg-surface">
      <div className="border-b rule px-4 py-3">
        <div className="label mb-1">Payment draft</div>
        <div className="text-[15px] font-semibold">{d.subscription.name}</div>
        <div className="num text-[13px] text-muted">{money(d.subscription.amount, d.subscription.currency)} · due {d.subscription.next_renewal}</div>
      </div>
      <dl className="divide-y divide-[var(--color-rule)] px-4 text-[13px]">
        <div className="flex justify-between py-2"><dt className="text-muted">Route</dt><dd>{d.plan.needsConversion ? `${d.plan.sourceToken} → ${d.plan.destinationToken}` : d.plan.destinationToken}</dd></div>
        {d.quote?.pay && <div className="flex justify-between py-2"><dt className="text-muted">You pay</dt><dd className="num">{d.quote.pay}</dd></div>}
        {d.quote?.rate && <div className="flex justify-between py-2"><dt className="text-muted">Rate</dt><dd className="num">{d.quote.rate}</dd></div>}
        {(d.quote?.error || d.quote?.reason) && <div className="py-2 text-alert">{d.quote.error ?? d.quote.reason}</div>}
        <div className="flex justify-between py-2"><dt className="text-muted">Balance</dt><dd className={`num ${d.balance?.sufficient === false ? "text-alert" : ""}`}>{d.balance?.available ? `${d.balance.available} ${d.balance.token}` : d.balance?.error}</dd></div>
      </dl>
      {d.plan.problems.length > 0 && <ul className="space-y-1 border-t rule px-4 py-3 text-[12px] text-alert">{d.plan.problems.map((p) => <li key={p}>{p}</li>)}</ul>}
      <div className="border-t rule p-3">
        <Link href={d.review_url} className="btn btn-primary btn-sm w-full">Review and approve</Link>
      </div>
    </div>
  );
}

interface Proposal {
  action: "confirm" | "dismiss" | "restore" | "categorise";
  changes: { id: string; name: string; from: string; to: string; patch?: Partial<import("@/lib/types").Subscription> }[];
  reason: string | null;
}

function ProposalCard({ p, applied, onApply }: { p: Proposal; applied: boolean; onApply(): void }) {
  const verb = p.action === "confirm" ? "Confirm" : p.action === "dismiss" ? "Dismiss" : p.action === "categorise" ? "Apply" : "Restore";
  return (
    <div className="mt-3 rounded-[6px] border rule bg-surface">
      <div className="flex items-center justify-between border-b rule px-4 py-2.5">
        <span className="label">Proposed change</span>
        <span className="text-[12px] text-muted">{p.changes.length} item{p.changes.length > 1 ? "s" : ""}</span>
      </div>
      <ul className="divide-y divide-[var(--color-rule)] px-4 text-[13px]">
        {p.changes.map((c) => (
          <li key={c.id} className="flex items-center justify-between py-2">
            <Link href={`/payments/${encodeURIComponent(c.id)}`} className="hover:underline">{c.name}</Link>
            <span className="text-[12px] text-muted">{c.from} → <span className={c.to === "dismissed" ? "text-alert" : c.to === "confirmed" ? "text-accent" : ""}>{c.to}</span></span>
          </li>
        ))}
      </ul>
      {p.reason && <p className="border-t rule px-4 py-2 text-[12px] text-muted">{p.reason}</p>}
      <div className="flex flex-wrap items-center gap-3 border-t rule px-4 py-3">
        {applied ? (
          <span className="pill pill-green">Applied</span>
        ) : (
          <button className="btn btn-primary btn-sm" onClick={onApply}>{verb} {p.changes.length > 1 ? `all ${p.changes.length}` : ""}</button>
        )}
        <span className="text-[12px] text-muted">Changes your list on this device only.</span>
      </div>
    </div>
  );
}
