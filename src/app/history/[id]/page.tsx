"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { HashLink } from "@/components/bits";
import { Missing } from "@/components/empty";
import { AddressBlock } from "@/components/recipients";
import { Amount, Icon, PageBar, StatusPill } from "@/components/ui";
import { useStore } from "@/lib/db/store";
import { date } from "@/lib/format";
import { approve, canRetry, cancel, retry } from "@/lib/money/actions";
import { accessState } from "@/lib/money/runner";

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default function ActivityDetail() {
  const { id } = useParams<{ id: string }>();
  const store = useStore();
  const { state, ready } = store;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  if (!ready) return null;
  const a = state.activity.find((x) => x.id === id);
  if (!a) return <Missing what="activity" back="/history" backLabel="Back to activity" />;
  const rule = a.ruleId ? state.rules.find((r) => r.id === a.ruleId) : undefined;
  const retried = state.activity.find((x) => x.retryOf === a.id);
  const lost = a.status === "failed" && !a.txHash && /lost track/.test(a.error ?? "");
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr(undefined);
    try {
      await fn();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-[680px] lg:mx-0">
      <div className="px-4 pt-4 text-[13px] sm:px-6 lg:px-8 lg:pt-8"><Link href="/history" className="inline-flex items-center gap-1 text-muted hover:text-ink"><Icon name="back" size={15} />activity</Link></div>
      <PageBar title={<span>{a.kind === "conversion" ? "Conversion" : `Transfer to ${a.recipientName ?? "recipient"}`}</span>} sub={when(a.createdAt)} />
      <div className="space-y-4 px-4 pb-10 sm:px-6 lg:px-8">
        <section className="panel">
          <div className="flex items-start justify-between gap-3 px-4 py-4">
            <div>
              {a.kind === "conversion" ? (
                <>
                  <div className="text-[13px] text-muted">{a.status === "completed" ? "Converted" : "Convert"}</div>
                  <div className="figure mt-1 text-[22px]">{a.amount ? <Amount value={a.amount} token={a.token} /> : <span>{a.token === "USDT" ? "USD₮" : "cNGN"}</span>} <span className="text-muted">→</span> {a.toAmount ? <Amount value={a.toAmount} token={a.toToken!} /> : <span>{a.toToken === "USDT" ? "USD₮" : "cNGN"}</span>}</div>
                </>
              ) : (
                <Amount value={a.amount} token={a.token} className="figure block text-[28px]" />
              )}
            </div>
            <StatusPill status={a.status} />
          </div>
          {a.note && <p className="border-t rule px-4 py-3 text-[13.5px] text-ink-2">{a.note}</p>}
          {(a.error || a.refusals?.length) && (
            <div className="border-t rule bg-alert-wash/60 px-4 py-3 text-[13.5px]">
              {a.refusals?.map((r) => <p key={r}>{r}</p>)}
              {a.error && <p className="text-ink-2">{a.error}</p>}
              <p className="mt-1 text-[12.5px] text-muted">{a.txHash ? "" : "Nothing left your payment wallet."}</p>
            </div>
          )}
          <dl className="rows border-t rule text-[13.5px]">
            {a.occurrence && <Row k="For the transfer due">{date(a.occurrence)}</Row>}
            {a.scheduleId && <Row k="Schedule"><Link href={`/transfers/${a.scheduleId}`} className="link">See schedule</Link></Row>}
            {rule && <Row k="Money rule"><Link href={`/rules/${rule.id}`} className="link">{rule.name}</Link></Row>}
            {a.fee && <Row k="Textile FX fee"><Amount value={a.fee} token={a.token} /></Row>}
            {a.rfqId && <Row k="Quote reference"><span className="font-mono text-[12px]">{a.rfqId}</span></Row>}
            {a.txHash && <Row k="Transaction"><HashLink hash={a.txHash} /></Row>}
            {a.txHash && <Row k="Checked on Celo">{a.verifiedAt ? <span className="text-positive">Yes, {when(a.verifiedAt)}</span> : a.status === "processing" ? "Waiting for confirmation" : "—"}</Row>}
            <Row k="Last update">{when(a.updatedAt)}</Row>
          </dl>
          {a.recipient && <div className="border-t rule px-4 py-3"><div className="mb-1.5 text-[12.5px] text-muted">Sent to</div><AddressBlock address={a.recipient} /></div>}
        </section>

        {err && <p className="callout callout-red block text-[13px]" role="alert">{err}</p>}
        {a.status === "awaiting_approval" && (
          <div className="space-y-2">
            {accessState(state) !== "on" && <p className="text-[12.5px] text-amber">Automation is {accessState(state) === "off" ? "paused" : "not set up"}, but you can still approve this one. It runs within your access and limits.</p>}
            <div className="grid grid-cols-2 gap-2 sm:flex">
              <button className="btn btn-primary" disabled={busy || !state.autopilot?.sealedPolicy} onClick={() => act(() => approve(store, a))}>{busy ? "Working…" : a.kind === "conversion" ? "Approve conversion" : "Send now"}</button>
              <button className="btn btn-ghost" disabled={busy} onClick={() => cancel(store, a)}>{a.kind === "conversion" ? "Don't convert" : "Skip this one"}</button>
            </div>
            {a.kind === "conversion" && <p className="text-[12.5px] text-muted">subscan gets a firm Textile FX quote when you approve, and stops if it costs more than the rule allows.</p>}
          </div>
        )}
        {canRetry(a, state.activity) && (
          <div className="space-y-2">
            {lost && <p className="callout callout-amber block text-[13px]">Check your payment wallet&rsquo;s history before retrying, in case this went through. <a className="font-semibold underline" href={`https://celoscan.io/address/${state.autopilot?.wallet}`} target="_blank" rel="noreferrer">Open it on Celoscan</a></p>}
            <button className="btn btn-primary" disabled={busy || !state.autopilot?.sealedPolicy} onClick={() => act(() => retry(store, a))}>{busy ? "Working…" : "Try again"}</button>
          </div>
        )}
        {retried && <p className="text-[13px]">Retried: <Link href={`/history/${retried.id}`} className="link">see the new attempt</Link></p>}
      </div>
    </div>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-4 px-4 py-2.5"><dt className="text-muted">{k}</dt><dd className="text-right">{children}</dd></div>;
}
