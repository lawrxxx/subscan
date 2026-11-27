"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { attentionItems, dueIn } from "@/lib/attention";
import { TOKENS } from "@/lib/celo/config";
import { income, savingsPotential, upcomingRenewals } from "@/lib/detection/analysis";
import { useRates, useStore } from "@/lib/db/store";
import { date, money, readableDates } from "@/lib/format";
import type { AppState } from "@/lib/types";
import { Markdown } from "@/components/bits";
import { Avatar, EmptyPanel, Icon, PageBar, PayStatus, UploadButton } from "@/components/ui";

interface Trace { name: string; input: Record<string, unknown>; result: unknown; error?: boolean }
interface Turn { role: "user" | "assistant"; content: string; trace?: Trace[]; mode?: "claude" | "local"; error?: boolean }

const PROMPTS = [
  "How much do I owe this month?",
  "Help me organise my bills before payday",
  "Which subscriptions can I cancel?",
  "Identify duplicate payments",
  "Confirm all high-confidence bills",
  "Analyse my statement",
];

const TOOL_LABEL: Record<string, string> = {
  list_subscriptions: "Looked up subscriptions",
  get_subscription: "Opened subscription",
  spending_analysis: "Analysed spending",
  upcoming_renewals: "Checked renewals",
  find_waste: "Scanned for waste",
  check_wallet_balance: "Read wallet balance on Celo",
  prepare_payment: "Prepared payment draft",
  transaction_status: "Checked transaction status",
  propose_subscription_changes: "Proposed changes to your bills",
  search_transactions: "Searched transactions",
  spending_breakdown: "Broke down spending",
  income_and_payday: "Checked income & payday",
  savings_analysis: "Estimated savings",
};

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

export default function Agent() {
  const { state, ready, updateSubscription, logAction, removePayment } = useStore();
  const home = state.settings.homeCurrency;
  const { rates } = useRates(home);
  const today = new Date().toISOString().slice(0, 10);
  const [applied, setApplied] = useState<Record<string, boolean>>({});
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const chat = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (turns.length) end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [turns, busy]);

  async function ask(q: string) {
    const question = q.trim();
    if (!question || busy) return;
    const next: Turn[] = [...turns, { role: "user", content: question }];
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
      if (!r.ok) throw new Error(j.error ?? "Agent unavailable");
      setTurns([...next, { role: "assistant", content: j.data.text, trace: j.data.trace, mode: j.data.mode }]);
    } catch (e) {
      setTurns([...next, { role: "assistant", content: e instanceof Error ? e.message : String(e), error: true }]);
    } finally {
      setBusy(false);
    }
  }

  // Deep links (e.g. "Ask the agent" on the overview) arrive as ?q=…
  const asked = useRef(false);
  useEffect(() => {
    if (!ready || asked.current || (!state.subscriptions.length && !state.transactions.length)) return;
    const q = new URLSearchParams(window.location.search).get("q");
    if (q) {
      asked.current = true;
      window.history.replaceState(null, "", "/agent");
      void ask(q.slice(0, 300));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, state.subscriptions.length]);

  const subs = state.subscriptions;
  const attention = useMemo(() => attentionItems(state, today).filter((a) => !a.id.startsWith("pd-") && a.id !== "review"), [state, today]);
  const savings = useMemo(() => savingsPotential(subs, home, rates, today), [subs, home, rates, today]);
  const inc = useMemo(() => income(state.transactions, home, today), [state.transactions, home, today]);
  const upcoming = useMemo(() => upcomingRenewals(subs, today, 14), [subs, today]);
  const drafts = state.payments.filter((p) => p.status === "prepared");
  const review = subs.filter((s) => s.status === "detected");
  const sure = review.filter((s) => s.confidence >= 0.85);
  const done = useMemo(() => {
    const acts = (state.actions ?? []).map((a) => ({ id: a.id, at: a.at, title: a.title, detail: a.detail, href: a.href }));
    const paid = state.payments.filter((p) => p.status === "confirmed" && !(state.actions ?? []).some((a) => a.kind === "payment-sent" && a.href === `/activity/${p.id}`)).map((p) => ({ id: p.id, at: p.createdAt, title: `Paid ${p.merchant}`, detail: `${p.destinationAmount} ${TOKENS[p.destinationToken].display} confirmed on Celo`, href: `/activity/${p.id}` }));
    return [...acts, ...paid].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8);
  }, [state.actions, state.payments]);

  const lastMode = [...turns].reverse().find((t) => t.mode)?.mode;

  if (!ready) return null;
  if (!subs.length && !state.transactions.length)
    return (
      <div>
        <PageBar title="Agent" sub="Your bills agent works from the statements you upload." />
        <div className="px-4 sm:px-6 lg:px-8">
          <section className="panel">
            <EmptyPanel icon="agent" title="Nothing for the agent to work on yet" action={<UploadButton />}>
              Upload a statement and the agent will queue up bills to review, payments coming due and places you could save. It never acts without your approval.
            </EmptyPanel>
          </section>
        </div>
      </div>
    );

  const confirmAll = () => {
    sure.forEach((s) => updateSubscription(s.id, { status: "confirmed" }));
    logAction({ kind: "confirmed", title: `Confirmed ${sure.length} high-confidence bill${sure.length === 1 ? "" : "s"}`, detail: sure.map((s) => s.displayName).join(", "), href: "/bills" });
  };
  const awaiting = drafts.length + (review.length ? 1 : 0);

  return (
    <div>
      <PageBar
        title="Agent"
        sub="Work the agent has queued up from your statements. Nothing changes or moves money until you approve it."
        actions={lastMode && <span className={`pill ${lastMode === "local" ? "pill-amber" : "pill-green"}`}>{lastMode === "claude" ? "Claude with tools" : "Local mode · no model key"}</span>}
      />

      <div className="grid gap-4 px-4 sm:px-6 lg:px-8 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="min-w-0 space-y-4">
          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title flex items-center gap-2">Awaiting your approval <span className="count">{awaiting}</span></h2>
            </div>
            {!awaiting ? (
              <EmptyPanel icon="check" title="Nothing waiting on you">Ask the agent to prepare a payment or tidy your bills, and it will appear here.</EmptyPanel>
            ) : (
              <ul className="divide-y divide-[var(--color-rule)]">
                {drafts.map((p) => (
                  <li key={p.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar name={p.merchant} />
                      <div className="min-w-0">
                        <div className="text-[13.5px] font-medium">Pay {p.merchant} <span className="ml-1 align-middle"><PayStatus status={p.status} /></span></div>
                        <div className="text-[12.5px] text-muted num">{p.sourceAmount} {TOKENS[p.sourceToken].display} → {p.destinationAmount} {TOKENS[p.destinationToken].display}{p.rate ? ` · ${p.rate}` : ""}</div>
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      <Link href={`/pay/${encodeURIComponent(p.subscriptionId)}`} className="btn btn-primary btn-sm">Review and approve</Link>
                      <button className="btn btn-quiet btn-sm" onClick={() => removePayment(p.id)}>Discard</button>
                    </div>
                  </li>
                ))}
                {review.length > 0 && (
                  <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-amber-wash text-amber"><Icon name="bills" size={16} /></span>
                      <div className="min-w-0">
                        <div className="text-[13.5px] font-medium">Confirm {review.length} detected bill{review.length === 1 ? "" : "s"}</div>
                        <div className="truncate text-[12.5px] text-muted">{review.slice(0, 4).map((s) => s.displayName).join(", ")}{review.length > 4 ? ` and ${review.length - 4} more` : ""}</div>
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      {sure.length > 0 && <button className="btn btn-primary btn-sm" onClick={confirmAll}>Confirm {sure.length} high-confidence</button>}
                      <Link href="/bills?view=review" className="btn btn-ghost btn-sm">Review each</Link>
                    </div>
                  </li>
                )}
              </ul>
            )}
          </section>

          <section className="panel">
            <div className="panel-head"><h2 className="panel-title flex items-center gap-2">Recommendations <span className="count">{attention.length + savings.flags.length + (inc.nextPayday ? 1 : 0)}</span></h2></div>
            <ul className="divide-y divide-[var(--color-rule)]">
              {attention.map((a) => (
                <li key={a.id} className="flex items-start justify-between gap-3 px-4 py-3 sm:px-5">
                  <div className="flex min-w-0 gap-3">
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${a.severity === "high" ? "bg-alert" : a.severity === "medium" ? "bg-amber" : "bg-line-strong"}`} />
                    <div className="min-w-0"><div className="text-[13.5px] font-medium">{a.title}</div><div className="text-[12.5px] text-muted">{readableDates(a.detail)}</div></div>
                  </div>
                  <Link href={a.href} className="btn btn-ghost btn-sm shrink-0">{a.action}</Link>
                </li>
              ))}
              {savings.flags.map((f) => (
                <li key={f.subscriptionId} className="flex items-start justify-between gap-3 px-4 py-3 sm:px-5">
                  <div className="flex min-w-0 gap-3">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" />
                    <div className="min-w-0">
                      <div className="text-[13.5px] font-medium">Consider cancelling {f.name} <span className="num font-normal text-muted">· saves {money(f.monthlyHome ?? f.monthly, f.monthlyHome !== null ? home : f.currency)}/mo</span></div>
                      <div className="text-[12.5px] text-muted">{readableDates(f.reason[0].toUpperCase() + f.reason.slice(1))}</div>
                    </div>
                  </div>
                  <button className="btn btn-ghost btn-sm shrink-0" onClick={() => ask(`Should I cancel ${f.name}?`)}>Ask why</button>
                </li>
              ))}
              {inc.nextPayday && (
                <li className="flex items-start justify-between gap-3 px-4 py-3 sm:px-5">
                  <div className="flex min-w-0 gap-3">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-info" />
                    <div className="min-w-0"><div className="text-[13.5px] font-medium">Plan bills before payday</div><div className="text-[12.5px] text-muted">Next income expected around {date(inc.nextPayday)}.</div></div>
                  </div>
                  <button className="btn btn-ghost btn-sm shrink-0" onClick={() => ask("Help me organise my bills before payday")}>Plan it</button>
                </li>
              )}
              {!attention.length && !savings.flags.length && !inc.nextPayday && <li className="px-5 py-4 text-[13px] text-muted">No recommendations right now.</li>}
            </ul>
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="panel">
              <div className="panel-head"><h2 className="panel-title">Due in the next 14 days</h2><Link href="/bills" className="link text-[12.5px]">All bills</Link></div>
              {!upcoming.length ? (
                <p className="px-5 py-4 text-[13px] text-muted">Nothing due in the next two weeks.</p>
              ) : (
                <ul className="divide-y divide-[var(--color-rule)]">
                  {upcoming.slice(0, 6).map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px] sm:px-5">
                      <Link href={`/bills/${encodeURIComponent(s.id)}`} className="min-w-0 truncate hover:underline">{s.displayName}</Link>
                      <span className="flex shrink-0 items-center gap-3">
                        <span className="num text-muted">{dueIn(s, today) === 0 ? "Today" : `${dueIn(s, today)}d`}</span>
                        <span className="num">{s.billType === "variable" ? "≈" : ""}{money(s.amount, s.currency)}</span>
                        <Link href={`/pay/${encodeURIComponent(s.id)}`} className="btn btn-ghost btn-sm">Pay</Link>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="panel">
              <div className="panel-head"><h2 className="panel-title">Completed</h2></div>
              {!done.length ? (
                <p className="px-5 py-4 text-[13px] text-muted">Actions you approve are logged here.</p>
              ) : (
                <ul className="divide-y divide-[var(--color-rule)]">
                  {done.map((d) => (
                    <li key={d.id} className="flex items-start gap-2.5 px-4 py-2.5 text-[13px] sm:px-5">
                      <Icon name="check" size={15} className="mt-0.5 shrink-0 text-accent" />
                      <div className="min-w-0">
                        {d.href ? <Link href={d.href} className="font-medium hover:underline">{d.title}</Link> : <span className="font-medium">{d.title}</span>}
                        <div className="truncate text-[12px] text-muted">{d.detail ? `${d.detail} · ` : ""}{new Date(d.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>

        <section ref={chat} className="panel flex min-h-[420px] flex-col xl:sticky xl:top-6 xl:h-[calc(100dvh-140px)] xl:self-start">
          <div className="panel-head"><h2 className="panel-title flex items-center gap-2"><Icon name="agent" size={16} className="text-accent" />Ask the agent</h2>{turns.length > 0 && <button className="btn btn-quiet btn-sm" onClick={() => { setTurns([]); setApplied({}); }}>Clear</button>}</div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            {!turns.length ? (
              <div>
                <p className="text-[13px] text-muted">Ask about your spending, plan around payday or have it prepare a payment. It uses the tools listed under each answer so you can see what it looked at.</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {PROMPTS.map((p) => <button key={p} onClick={() => ask(p)} className="rounded-full border rule bg-surface px-3 py-1.5 text-left text-[12.5px] hover:border-line-strong hover:bg-paper-2">{p}</button>)}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {turns.map((t, i) =>
                  t.role === "user" ? (
                    <div key={i} className="ml-8 rounded-[8px] bg-paper-2 px-3 py-2 text-[13.5px]">{t.content}</div>
                  ) : (
                    <div key={i}>
                      {t.trace && t.trace.length > 0 && (
                        <ul className="mb-2 flex flex-wrap gap-1">
                          {t.trace.map((tr, j) => <li key={j} className={`tag ${tr.error ? "text-alert" : ""}`}>{TOOL_LABEL[tr.name] ?? tr.name}</li>)}
                        </ul>
                      )}
                      <div className={`text-[13.5px] leading-relaxed ${t.error ? "text-alert" : ""}`}><Markdown text={t.content} /></div>
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
                              logAction({ kind: p.action === "confirm" ? "confirmed" : p.action === "dismiss" ? "dismissed" : p.action === "restore" ? "restored" : "recategorised", title: `${p.action === "categorise" ? "Updated" : p.action === "confirm" ? "Confirmed" : p.action === "dismiss" ? "Dismissed" : "Restored"} ${p.changes.length === 1 ? p.changes[0].name : `${p.changes.length} bills`}`, detail: "Approved from the agent" });
                              setApplied((a) => ({ ...a, [key]: true }));
                            }}
                          />
                        ))}
                    </div>
                  ),
                )}
                {busy && <div className="flex items-center gap-2 text-[12.5px] text-muted"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />Working…</div>}
                <div ref={end} />
              </div>
            )}
          </div>
          <form
            className="border-t rule p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void ask(input);
            }}
          >
            <div className="flex gap-2">
              <input className="input flex-1" placeholder="Ask about your bills…" value={input} onChange={(e) => setInput(e.target.value)} disabled={busy} aria-label="Message the agent" />
              <button className="btn btn-primary" disabled={busy || !input.trim()}>Send</button>
            </div>
          </form>
        </section>
      </div>
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
            <Link href={`/bills/${encodeURIComponent(c.id)}`} className="hover:underline">{c.name}</Link>
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
