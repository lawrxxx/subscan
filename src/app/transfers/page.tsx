"use client";
import Link from "next/link";
import { useState } from "react";
import { AddRecipient, RecipientRow } from "@/components/recipients";
import { Amount, Avatar, EmptyPanel, Icon, PageBar } from "@/components/ui";
import { useStore } from "@/lib/db/store";
import { date } from "@/lib/format";
import { syncPolicy } from "@/lib/money/policy";
import { describe, nextDate } from "@/lib/money/schedule";

export default function Transfers() {
  const store = useStore();
  const { state, ready } = store;
  const [tab, setTab] = useState<"schedules" | "recipients">("schedules");
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [err, setErr] = useState<string>();
  if (!ready) return null;
  const today = new Date().toISOString().slice(0, 10);
  const live = state.schedules.filter((s) => s.status === "active" || s.status === "paused");
  const done = state.schedules.filter((s) => s.status === "cancelled" || s.status === "ended");

  return (
    <div>
      <PageBar title="transfers" sub="recurring transfers to people you've saved" actions={<Link href="/transfers/new" className="btn btn-primary"><Icon name="plus" size={16} />schedule a transfer</Link>} />
      <div className="mx-auto max-w-[760px] space-y-4 px-4 sm:px-6 lg:mx-0 lg:px-8">
        <div className="seg flex w-full sm:inline-flex sm:w-auto" role="tablist">
          <button role="tab" className="flex-1 sm:flex-none" aria-selected={tab === "schedules"} aria-pressed={tab === "schedules"} onClick={() => setTab("schedules")}>schedules<span className="count">{live.length}</span></button>
          <button role="tab" className="flex-1 sm:flex-none" aria-selected={tab === "recipients"} aria-pressed={tab === "recipients"} onClick={() => setTab("recipients")}>saved recipients<span className="count">{state.recipients.length}</span></button>
        </div>
        {err && <p className="callout callout-red block text-[13px]" role="alert">{err}</p>}

        {tab === "schedules" ? (
          !live.length ? (
            <section className="panel">
              <EmptyPanel icon="transfer" title="No transfers scheduled" action={<Link href="/transfers/new" className="btn btn-primary">Schedule a transfer</Link>}>Send money to family or anyone you&rsquo;ve saved, every week, every month or once, within limits you set.</EmptyPanel>
            </section>
          ) : (
            <section className="panel">
              <ul className="rows">
                {live.map((s) => {
                  const r = state.recipients.find((x) => x.id === s.recipientId);
                  const nd = nextDate(s, today);
                  return (
                    <li key={s.id}>
                      <Link href={`/transfers/${s.id}`} className="row">
                        <span className="flex min-w-0 items-center gap-3">
                          <Avatar name={r?.name ?? "?"} size={36} />
                          <span className="min-w-0">
                            <span className="flex min-w-0 items-center gap-2"><span className="row-title">{r?.name ?? "Removed recipient"}</span>{s.status === "paused" && <span className="pill shrink-0">paused</span>}</span>
                            <span className="row-sub">{describe(s)}{nd ? ` · next ${date(nd, "day")}` : ""}</span>
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-1.5"><Amount value={s.amount} token={s.token} className="row-amount" /><Icon name="chev" size={16} className="chev" /></span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          )
        ) : (
          <section className="space-y-3">
            {adding ? (
              <AddRecipient existing={state.recipients} onCancel={() => setAdding(false)} onDone={async (r) => { store.upsertRecipient(r); setAdding(false); await syncPolicy(store).catch((e) => setErr(`Saved here, but subscan's server couldn't be updated yet: ${(e as Error).message}`)); }} />
            ) : (
              <button className="btn btn-ghost w-full" onClick={() => setAdding(true)}><Icon name="plus" size={16} />add a recipient</button>
            )}
            {state.recipients.length > 0 && (
              <div className="panel">
                <ul className="rows">
                  {state.recipients.map((r) => (
                    <li key={r.id}>
                      <RecipientRow r={r}>
                        {removing === r.id ? (
                          <>
                            <button className="btn btn-danger btn-sm" onClick={async () => { store.removeRecipient(r.id); setRemoving(null); await syncPolicy(store).catch(() => {}); }}>Remove</button>
                            <button className="btn btn-quiet btn-sm" onClick={() => setRemoving(null)}>Keep</button>
                          </>
                        ) : (
                          <button className="btn btn-quiet btn-sm" onClick={() => setRemoving(r.id)} aria-label={`Remove ${r.name}`}><Icon name="trash" size={16} /></button>
                        )}
                      </RecipientRow>
                      {removing === r.id && state.schedules.some((s) => s.recipientId === r.id && (s.status === "active" || s.status === "paused")) && <p className="px-4 pb-2 text-[12.5px] text-amber">Their scheduled transfers will be cancelled.</p>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="px-1 text-[12.5px] text-muted">subscan only ever sends to these addresses. Its server checks this list before every transfer.</p>
          </section>
        )}

        {tab === "schedules" && done.length > 0 && (
          <details className="px-1 text-[13px]">
            <summary className="cursor-pointer text-muted">{done.length} ended or cancelled</summary>
            <ul className="mt-2 space-y-1">{done.map((s) => <li key={s.id}><Link href={`/transfers/${s.id}`} className="link">{state.recipients.find((r) => r.id === s.recipientId)?.name ?? "Removed recipient"} · {s.amount} {s.token === "USDT" ? "USD₮" : "cNGN"} · {s.status}</Link></li>)}</ul>
          </details>
        )}
      </div>
    </div>
  );
}
