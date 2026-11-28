"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { EmptyPanel, PageBar, UploadButton } from "@/components/ui";
import { decide, type AgentDecision, type Decision } from "@/lib/agent/rules";
import { runAutopilotFor } from "@/lib/autopilot/runner";
import { TOKENS } from "@/lib/celo/config";
import { useStore } from "@/lib/db/store";
import { date, money, readableDates } from "@/lib/format";
import type { AppState } from "@/lib/types";

// The data a tool sees: the user's own records, never the sealed Autopilot tokens.
function snapshot(state: AppState): AppState {
  return {
    ...state,
    imports: undefined,
    autopilot: state.autopilot ? { ...state.autopilot, sealedPolicy: state.autopilot.sealedPolicy ? "set" : undefined, sealedKey: undefined } : undefined,
    transactions: state.transactions.slice(-3000),
  };
}

async function tool<T>(name: string, state: AppState, input: Record<string, unknown> = {}): Promise<T> {
  const r = await fetch("/api/agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool: name, input, state: snapshot(state) }) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? "Couldn't work that out");
  return j.data.result as T;
}

interface Answer {
  title: string;
  summary: string;
  rows: { label: string; value: string; sub?: string; href?: string }[];
  note?: string;
}

const QUESTIONS: { id: string; label: string }[] = [
  { id: "monthly", label: "How much do I spend every month?" },
  { id: "upcoming", label: "What payments are coming up?" },
  { id: "where", label: "Where does most of my money go?" },
  { id: "twice", label: "Am I paying for anything twice?" },
  { id: "save", label: "Where could I save money?" },
  { id: "autopilot", label: "What will Autopilot pay?" },
];

/** Fixed templates over deterministic tool results. */
async function answer(id: string, state: AppState): Promise<Answer> {
  const home = state.settings.homeCurrency;
  const m = (n: number, c = home) => money(n, c);
  switch (id) {
    case "monthly": {
      const [a, b] = await Promise.all([tool<{ monthlyHome: number | null; annualHome: number | null; byCurrency: { currency: string; monthly: number; count: number }[] }>("spending_analysis", state), tool<{ monthly_average_out: number; period: { from: string; to: string } | null }>("spending_breakdown", state)]);
      return {
        title: "Your monthly spending",
        summary: a.monthlyHome !== null ? `Regular payments come to about ${m(a.monthlyHome)} a month (${m(a.annualHome ?? 0)} a year).` : "Your regular payments are in more than one currency.",
        rows: [
          ...a.byCurrency.map((c) => ({ label: `Regular payments in ${c.currency}`, value: `${m(c.monthly, c.currency)}/mo`, sub: `${c.count} payments` })),
          ...(b.period ? [{ label: "All money out (statement average)", value: `${m(b.monthly_average_out)}/mo`, sub: `${date(b.period.from)} – ${date(b.period.to)}` }] : []),
        ],
        note: "Regular payments include ones you haven't confirmed yet.",
      };
    }
    case "upcoming": {
      const r = await tool<{ renewals: { id: string; name: string; amount: number; currency: string; next_renewal: string; days_until: number; bill_type: string }[] }>("upcoming_renewals", state, { within_days: 30 });
      return {
        title: "Coming up in the next 30 days",
        summary: r.renewals.length ? `${r.renewals.length} payment${r.renewals.length === 1 ? "" : "s"} expected.` : "Nothing expected in the next 30 days.",
        rows: r.renewals.map((x) => ({ label: x.name, value: `${x.bill_type === "variable" ? "≈ " : ""}${m(x.amount, x.currency)}`, sub: `${date(x.next_renewal)} · in ${x.days_until} days`, href: `/payments/${encodeURIComponent(x.id)}` })),
        note: "Dates are estimates from your payment history.",
      };
    }
    case "where": {
      const r = await tool<{ monthly_average_out: number; recurring_bills_share: number; by_category: { category: string; per_month: number }[] }>("spending_breakdown", state);
      return {
        title: "Where your money goes",
        summary: `About ${m(r.monthly_average_out)} goes out each month. ${Math.round(r.recurring_bills_share * 100)}% of it is regular payments.`,
        rows: r.by_category.slice(0, 8).map((c) => ({ label: c.category, value: `${m(c.per_month)}/mo` })),
      };
    }
    case "twice": {
      const [w, a] = await Promise.all([tool<{ flags: { subscriptionId: string; name: string; reason: string; monthly: number; currency: string }[] }>("find_waste", state), tool<{ possible_duplicates: { reason: string; items: string[] }[] }>("spending_analysis", state)]);
      const dupes = w.flags.filter((f) => /overlap|running at once|billed \d+ times|duplicate/i.test(f.reason));
      return {
        title: "Paying twice?",
        summary: dupes.length || a.possible_duplicates.length ? "These look like they overlap. Keep the one you use." : "Nothing looks duplicated.",
        rows: [...a.possible_duplicates.map((d) => ({ label: d.items.join(" + "), value: "", sub: d.reason })), ...dupes.map((f) => ({ label: f.name, value: `${m(f.monthly, f.currency)}/mo`, sub: readableDates(f.reason), href: `/payments/${encodeURIComponent(f.subscriptionId)}` }))],
      };
    }
    case "save": {
      const r = await tool<{ potential_monthly_saving: number; potential_yearly_saving: number; suggestions: { subscriptionId: string; name: string; reason: string; monthlyHome: number | null; monthly: number; currency: string }[] }>("savings_analysis", state);
      return {
        title: "Where you could save",
        summary: r.suggestions.length ? `Up to ${m(r.potential_monthly_saving)} a month (${m(r.potential_yearly_saving)} a year).` : "Nothing obvious to cut.",
        rows: r.suggestions.map((s) => ({ label: s.name, value: `${m(s.monthlyHome ?? s.monthly, s.monthlyHome !== null ? home : s.currency)}/mo`, sub: readableDates(s.reason[0].toUpperCase() + s.reason.slice(1)), href: `/payments/${encodeURIComponent(s.subscriptionId)}` })),
        note: "Ideas only. Nothing is cancelled for you.",
      };
    }
    default: {
      const r = await tool<{ set_up: boolean; on?: boolean; access?: string; expires?: string | null; note?: string; bills?: { name: string; amount: number; currency: string; next_due: string; will_pay_when_due: boolean; why_not: string[] }[] }>("autopilot_check", state);
      if (!r.set_up) return { title: "Autopilot", summary: r.note ?? "Autopilot isn't set up.", rows: [] };
      return {
        title: "What Autopilot will pay",
        summary: `Autopilot is ${r.on ? "on" : "off"}. Access ${r.access}${r.expires ? `, until ${date(r.expires)}` : ""}.`,
        rows: (r.bills ?? []).map((b) => ({ label: b.name, value: m(b.amount, b.currency), sub: b.will_pay_when_due ? `Will pay around ${date(b.next_due)}` : `Won't pay: ${b.why_not.join(", ")}` })),
        note: "Before each payment the wallet's balance and remaining monthly allowance are checked on Celo.",
      };
    }
  }
}

const GROUPS: { title: string; kinds: Decision[] }[] = [
  { title: "Needs you", kinds: ["needs_you", "blocked"] },
  { title: "Paying automatically", kinds: ["pay", "scheduled"] },
  { title: "Paid", kinds: ["paid"] },
  { title: "You pay these yourself", kinds: ["manual"] },
];
const TONE: Record<Decision, string> = { pay: "text-accent", scheduled: "text-accent", needs_you: "text-amber", blocked: "text-alert", paid: "text-muted", manual: "text-muted", no_date: "text-muted" };
const WORD: Record<Decision, string> = { pay: "Paying now", scheduled: "Scheduled", needs_you: "Needs you", blocked: "Stopped", paid: "Paid", manual: "Pay yourself", no_date: "No date yet" };

export default function Agent() {
  const store = useStore();
  const { state, ready, removePayment } = store;
  const [open, setOpen] = useState<string | null>(null);
  const [ans, setAns] = useState<Answer | null>(null);
  const [ansErr, setAnsErr] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [runNotes, setRunNotes] = useState<string[]>([]);
  const decisions = useMemo(() => decide(state), [state]);

  async function ask(id: string) {
    setOpen(id);
    setAns(null);
    setAnsErr(undefined);
    setLoading(true);
    try {
      setAns(await answer(id, state));
    } catch (e) {
      setAnsErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!ready) return;
    const q = new URLSearchParams(window.location.search).get("q");
    if (q && QUESTIONS.some((x) => x.id === q)) void ask(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  if (!ready) return null;
  if (!state.subscriptions.length && !state.transactions.length)
    return (
      <div>
        <PageBar title="Agent" sub="subscan's agent checks your bills and pays the ones you allow." />
        <div className="px-4 sm:px-6 lg:px-8">
          <section className="panel">
            <EmptyPanel icon="agent" title="Add a statement first" action={<UploadButton label="Add a statement" />}>The agent works from your own transactions.</EmptyPanel>
          </section>
        </div>
      </div>
    );

  const ap = state.autopilot;
  const access = !ap?.sealedPolicy ? "not set up" : ap.revokedAt ? "revoked" : (ap.expiry ?? 0) * 1000 <= Date.now() ? "expired" : ap.enabled ? "on" : "paused";
  const due = decisions.filter((d) => d.decision === "pay");
  const drafts = state.payments.filter((p) => p.status === "prepared");
  const activity = [
    ...(state.actions ?? []).map((a) => ({ id: a.id, at: a.at, title: a.title, detail: a.detail, href: a.href })),
    ...state.payments.filter((p) => p.via === "autopilot" && p.status !== "confirmed").map((p) => ({ id: p.id, at: p.createdAt, title: `Autopilot couldn't pay ${p.merchant}`, detail: p.refusals?.join(" ") ?? p.steps.find((s) => s.error)?.error, href: `/wallet/${p.id}` })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 10);

  return (
    <div className="mx-auto max-w-3xl">
      <PageBar title="Agent" sub="subscan's rule-based agent: it checks your regular payments each time you open the app and only pays within the access you granted." />
      <div className="space-y-4 px-4 pb-10 sm:px-6 lg:px-8">
        <section className="panel flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="text-[13.5px]">
            <div className="font-medium">Autopilot is {access}</div>
            <div className="text-[12.5px] text-muted">{ap?.expiry && access !== "not set up" ? `Access until ${date(new Date(ap.expiry * 1000).toISOString().slice(0, 10))} · ` : ""}Wallet and permissions by Altana · conversions by Textile FX</div>
          </div>
          <div className="flex gap-2">
            {due.length > 0 && access === "on" && (
              <button className="btn btn-primary" disabled={running} onClick={async () => { setRunning(true); setRunNotes([]); for (const d of due) { const msg = await runAutopilotFor(store, d.billId); setRunNotes((n) => [...n, msg]); } setRunning(false); }}>
                {running ? "Paying…" : `Pay ${due.length} due now`}
              </button>
            )}
            <Link href="/autopilot" className="btn btn-ghost">{access === "not set up" ? "Set up Autopilot" : "Autopilot settings"}</Link>
          </div>
          {runNotes.length > 0 && <ul className="w-full space-y-0.5 border-t rule pt-2 text-[13px] text-ink-2" aria-live="polite">{runNotes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
        </section>

        {drafts.length > 0 && (
          <section className="panel">
            <div className="panel-head"><h2 className="panel-title">Waiting for your approval</h2></div>
            <ul className="divide-y divide-[var(--color-rule-soft)]">
              {drafts.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13.5px]">
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

        {GROUPS.map((g) => {
          const items = decisions.filter((d) => g.kinds.includes(d.decision));
          if (!items.length) return null;
          return (
            <section key={g.title} className="panel" aria-label={g.title}>
              <div className="panel-head"><h2 className="panel-title">{g.title}</h2><span className="text-[12.5px] text-muted">{items.length}</span></div>
              <ul className="divide-y divide-[var(--color-rule-soft)]">
                {items.map((d) => <DecisionRow key={d.billId} d={d} />)}
              </ul>
            </section>
          );
        })}
        {decisions.some((d) => d.decision === "no_date") && <p className="text-[12.5px] text-muted">{decisions.filter((d) => d.decision === "no_date").length} confirmed payment(s) don&rsquo;t have enough history yet to schedule.</p>}
        {!decisions.length && <p className="rounded-[6px] bg-paper-2 px-3 py-2.5 text-[13.5px]">No confirmed regular payments yet. <Link href="/review" className="link">Check your payments</Link> so the agent knows what to look after.</p>}

        <section className="panel">
          <div className="panel-head"><h2 className="panel-title">Quick answers</h2></div>
          <div className="flex flex-col gap-1.5 px-4 py-3 sm:flex-row sm:flex-wrap">
            {QUESTIONS.map((q) => (
              <button key={q.id} onClick={() => ask(q.id)} aria-pressed={open === q.id} className={`rounded-[6px] border px-3 py-2.5 text-left text-[13.5px] sm:rounded-full sm:py-1.5 sm:text-[13px] ${open === q.id ? "border-accent bg-accent-wash" : "rule bg-surface hover:border-line-strong"}`}>{q.label}</button>
            ))}
          </div>
          {open && (
            <div className="border-t rule px-4 py-3" aria-live="polite">
              {loading ? (
                <p className="text-[13px] text-muted">Working it out from your transactions…</p>
              ) : ansErr ? (
                <p className="text-[13px] text-alert">{ansErr}</p>
              ) : ans ? (
                <>
                  <h3 className="text-[14.5px] font-semibold">{ans.title}</h3>
                  <p className="mt-0.5 text-[13.5px] text-ink-2">{ans.summary}</p>
                  {ans.rows.length > 0 && (
                    <ul className="mt-2 divide-y divide-[var(--color-rule-soft)] border-y rule-soft">
                      {ans.rows.map((r, i) => {
                        const body = (
                          <>
                            <span className="min-w-0"><span className="block truncate text-[13.5px]">{r.label}</span>{r.sub && <span className="block text-[12px] text-muted">{r.sub}</span>}</span>
                            <span className="num shrink-0 text-[13.5px]">{r.value}</span>
                          </>
                        );
                        return <li key={i}>{r.href ? <Link href={r.href} className="flex items-center justify-between gap-3 py-2 hover:bg-paper-2/50">{body}</Link> : <div className="flex items-center justify-between gap-3 py-2">{body}</div>}</li>;
                      })}
                    </ul>
                  )}
                  {ans.note && <p className="mt-2 text-[12px] text-muted">{ans.note}</p>}
                </>
              ) : null}
            </div>
          )}
        </section>

        {activity.length > 0 && (
          <section className="panel">
            <div className="panel-head"><h2 className="panel-title">Recent agent activity</h2></div>
            <ul className="divide-y divide-[var(--color-rule-soft)]">
              {activity.map((a) => (
                <li key={a.id} className="px-4 py-2.5 text-[13.5px]">
                  {a.href ? <Link href={a.href} className="font-medium hover:underline">{a.title}</Link> : <span className="font-medium">{a.title}</span>}
                  <div className="text-[12px] text-muted">{a.detail ? `${a.detail} · ` : ""}{new Date(a.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</div>
                </li>
              ))}
            </ul>
          </section>
        )}
        {state.payments.some((p) => p.via === "autopilot") && (
          <p className="text-[12.5px] text-muted">Every Autopilot payment, paid or refused, is in <Link href="/wallet" className="link">Settings → Wallet</Link> with its transaction hash.</p>
        )}
      </div>
    </div>
  );
}

function DecisionRow({ d }: { d: AgentDecision }) {
  return (
    <li id={`bill-${d.billId}`} className="px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <Link href={`/payments/${encodeURIComponent(d.billId)}`} className="min-w-0">
          <span className="block truncate text-[14px] font-medium hover:underline">{d.name}</span>
          <span className="block text-[12.5px] text-muted">{d.dueDate ? `${date(d.dueDate)}${d.daysUntil !== undefined ? ` · ${d.daysUntil < 0 ? `${-d.daysUntil} days late` : d.daysUntil === 0 ? "today" : `in ${d.daysUntil} days`}` : ""}` : "No date yet"}</span>
        </Link>
        <span className="shrink-0 text-right">
          <span className="num block text-[14px]">{money(d.amount, d.currency)}</span>
          <span className={`block text-[12px] font-medium ${TONE[d.decision]}`}>{WORD[d.decision]}</span>
        </span>
      </div>
      <ul className="mt-1 space-y-0.5 text-[12.5px] text-ink-2">{d.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
      {d.action && <Link href={d.action.href} className="btn btn-ghost btn-sm mt-2">{d.action.label}</Link>}
    </li>
  );
}

