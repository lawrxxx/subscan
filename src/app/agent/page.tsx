"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/db/store";
import { money } from "@/lib/format";
import type { AppState } from "@/lib/types";
import { Markdown } from "@/components/bits";

interface Trace { name: string; input: Record<string, unknown>; result: unknown; error?: boolean }
interface Turn { role: "user" | "assistant"; content: string; trace?: Trace[]; mode?: "claude" | "local"; error?: boolean }

const PROMPTS = [
  "Analyse my statement",
  "Show me all my monthly bills",
  "How much do I owe this month?",
  "What payments are coming up?",
  "Help me organise my bills before payday",
  "Which subscriptions can I cancel?",
  "Identify duplicate payments",
  "How much could I save by cancelling unused subscriptions?",
  "Prepare my electricity payment",
  "Confirm all high-confidence bills",
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
  const { state, ready, updateSubscription } = useStore();
  const [applied, setApplied] = useState<Record<string, boolean>>({});
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, busy]);

  async function ask(q: string) {
    const question = q.trim();
    if (!question || busy) return;
    const next: Turn[] = [...turns, { role: "user", content: question }];
    setTurns(next);
    setInput("");
    setBusy(true);
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

  // Deep links (e.g. "Plan with the agent" on the overview) arrive as ?q=…
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

  const lastMode = [...turns].reverse().find((t) => t.mode)?.mode;
  const drafts = turns.flatMap((t) => t.trace ?? []).filter((t) => t.name === "prepare_payment" && !(t.result as { error?: string }).error);
  const draft = drafts[drafts.length - 1]?.result as DraftResult | undefined;

  if (ready && !state.subscriptions.length && !state.transactions.length)
    return (
      <div className="px-4 py-16 sm:px-8 lg:px-12">
        <div className="kicker mb-3">Agent</div>
        <h1 className="display text-[46px]">Nothing to analyse yet.</h1>
        <p className="mt-3 text-muted">Your agent works from the statements you upload. <Link href="/onboarding" className="link">Upload a statement</Link> first, or try demo mode from the overview.</p>
      </div>
    );

  return (
    <div className="grid min-h-[calc(100dvh-1px)] xl:grid-cols-[1fr_360px]">
      <section className="flex min-w-0 flex-col xl:border-r xl:rule">
        <div className="border-b rule px-4 pt-8 pb-5 sm:px-8 lg:px-12">
          <div className="kicker mb-2 flex items-center gap-3">
            Agent workspace
            {lastMode && <span className={`tag ${lastMode === "local" ? "border-amber/40 bg-amber-wash text-amber" : ""}`}>{lastMode === "claude" ? "Claude · tool use" : "Local intent mode · no LLM key"}</span>}
          </div>
          <h1 className="display text-[36px] sm:text-[44px]">Ask about your bills.</h1>
          <p className="mt-2 max-w-xl text-[14px] text-muted">Your agent reads the transactions you imported and the bills found in them. It can explain your spending, plan around payday, tidy your list and prepare payments — you approve anything that changes or moves money.</p>
        </div>

        <div className="flex-1 px-4 py-6 sm:px-8 lg:px-12">
          {!turns.length && (
            <div className="grid max-w-3xl gap-px border rule bg-rule sm:grid-cols-2">
              {PROMPTS.map((p) => (
                <button key={p} onClick={() => ask(p)} className="bg-paper px-4 py-4 text-left text-[15px] hover:bg-paper-2">
                  <span className="display text-[19px]">“{p}”</span>
                </button>
              ))}
            </div>
          )}
          <div className="max-w-3xl space-y-8">
            {turns.map((t, i) =>
              t.role === "user" ? (
                <div key={i} className="border-t border-ink pt-4">
                  <div className="kicker mb-1">You asked</div>
                  <div className="display text-[24px]">{t.content}</div>
                </div>
              ) : (
                <div key={i}>
                  {t.trace && t.trace.length > 0 && (
                    <ul className="mb-3 space-y-1">
                      {t.trace.map((tr, j) => (
                        <li key={j} className="font-mono text-[11px] text-muted">
                          <span className={tr.error ? "text-alert" : "text-accent"}>→</span> {TOOL_LABEL[tr.name] ?? tr.name}
                          {Object.keys(tr.input).length > 0 && <span className="hidden text-faint sm:inline"> {JSON.stringify(tr.input)}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className={`text-[15px] leading-relaxed ${t.error ? "text-alert" : "text-ink"}`}>
                    <Markdown text={t.content} />
                  </div>
                  {(t.trace ?? [])
                    .filter((tr) => tr.name === "prepare_payment" && !(tr.result as { error?: string }).error)
                    .map((tr, j) => (
                      <div key={`d${j}`} className="mt-4 max-w-md xl:hidden">
                        <Draft d={tr.result as DraftResult} />
                      </div>
                    ))}
                  {(t.trace ?? [])
                    .map((tr, j) => ({ tr, key: `${i}-${j}` }))
                    .filter(({ tr }) => tr.name === "propose_subscription_changes" && ((tr.result as Proposal).changes?.length ?? 0) > 0)
                    .map(({ tr, key }) => (
                      <ProposalCard
                        key={key}
                        p={tr.result as Proposal}
                        applied={!!applied[key]}
                        onApply={() => {
                          (tr.result as Proposal).changes.forEach((c) => updateSubscription(c.id, c.patch ?? { status: c.to as "confirmed" | "dismissed" | "detected" }));
                          setApplied((a) => ({ ...a, [key]: true }));
                        }}
                      />
                    ))}
                </div>
              ),
            )}
            {busy && <div className="font-mono text-[12px] text-muted">→ working…</div>}
            <div ref={end} />
          </div>
        </div>

        <form
          className="sticky bottom-[57px] border-t rule bg-paper px-4 py-4 sm:px-8 lg:bottom-0 lg:px-12"
          onSubmit={(e) => {
            e.preventDefault();
            void ask(input);
          }}
        >
          <div className="flex max-w-3xl gap-2">
            <input className="field h-11 flex-1 text-[15px]" placeholder="e.g. Which renewals hit before the 15th?" value={input} onChange={(e) => setInput(e.target.value)} disabled={busy} />
            <button className="btn btn-primary h-11" disabled={busy || !input.trim()}>Ask</button>
          </div>
        </form>
      </section>

      <aside className="hidden px-8 py-8 xl:block">
        <div className="kicker mb-4">Payment draft</div>
        {draft ? <Draft d={draft} /> : <p className="text-[13px] text-muted">Ask the agent to prepare a payment. Drafts appear here for review — nothing is sent until you approve on the payment screen.</p>}
        <div className="mt-10 border-t rule pt-6">
          <div className="kicker mb-3">Tools available</div>
          <ul className="space-y-1.5 text-[13px] text-ink-2">
            {Object.values(TOOL_LABEL).map((l) => <li key={l}>{l}</li>)}
          </ul>
        </div>
      </aside>
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
    <div className="border border-ink">
      <div className="border-b border-ink px-4 py-3">
        <div className="display text-[22px]">{d.subscription.name}</div>
        <div className="num text-[13px] text-muted">{money(d.subscription.amount, d.subscription.currency)} · due {d.subscription.next_renewal}</div>
      </div>
      <dl className="divide-y divide-rule px-4 text-[13px]">
        <div className="flex justify-between py-2"><dt className="text-muted">Route</dt><dd>{d.plan.needsConversion ? `${d.plan.sourceToken} → ${d.plan.destinationToken}` : d.plan.destinationToken}</dd></div>
        {d.quote?.pay && <div className="flex justify-between py-2"><dt className="text-muted">You pay</dt><dd className="num">{d.quote.pay}</dd></div>}
        {d.quote?.rate && <div className="flex justify-between py-2"><dt className="text-muted">Rate</dt><dd className="num">{d.quote.rate}</dd></div>}
        {(d.quote?.error || d.quote?.reason) && <div className="py-2 text-alert">{d.quote.error ?? d.quote.reason}</div>}
        <div className="flex justify-between py-2"><dt className="text-muted">Balance</dt><dd className={`num ${d.balance?.sufficient === false ? "text-alert" : ""}`}>{d.balance?.available ? `${d.balance.available} ${d.balance.token}` : d.balance?.error}</dd></div>
      </dl>
      {d.plan.problems.length > 0 && <ul className="space-y-1 border-t rule px-4 py-3 text-[12px] text-alert">{d.plan.problems.map((p) => <li key={p}>{p}</li>)}</ul>}
      <div className="border-t border-ink p-3">
        <Link href={d.review_url} className="btn btn-primary w-full">Review &amp; approve</Link>
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
    <div className="mt-4 max-w-xl border border-ink">
      <div className="flex items-center justify-between border-b rule px-4 py-2.5">
        <span className="kicker">Proposed change</span>
        <span className="text-[12px] text-muted">{p.changes.length} item{p.changes.length > 1 ? "s" : ""}</span>
      </div>
      <ul className="divide-y divide-rule px-4 text-[14px]">
        {p.changes.map((c) => (
          <li key={c.id} className="flex items-center justify-between py-2">
            <Link href={`/subscriptions/${encodeURIComponent(c.id)}`} className="hover:underline">{c.name}</Link>
            <span className="text-[12px] text-muted">{c.from} → <span className={c.to === "dismissed" ? "text-alert" : c.to === "confirmed" ? "text-accent" : ""}>{c.to}</span></span>
          </li>
        ))}
      </ul>
      {p.reason && <p className="border-t rule px-4 py-2 text-[12px] text-muted">{p.reason}</p>}
      <div className="flex items-center gap-3 border-t border-ink px-4 py-3">
        {applied ? (
          <span className="text-[13px] text-accent">Applied ✓</span>
        ) : (
          <button className="btn btn-primary h-9" onClick={onApply}>{verb} {p.changes.length > 1 ? `all ${p.changes.length}` : ""}</button>
        )}
        <span className="text-[12px] text-muted">Changes your list on this device only.</span>
      </div>
    </div>
  );
}
