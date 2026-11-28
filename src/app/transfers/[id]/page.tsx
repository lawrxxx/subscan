"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Missing } from "@/components/empty";
import { ActivityRows } from "@/components/money";
import { AddressBlock } from "@/components/recipients";
import { ScheduleFields } from "@/components/schedule-form";
import { Amount, Icon, PageBar } from "@/components/ui";
import { useStore } from "@/lib/db/store";
import { date } from "@/lib/format";
import { sentTotal } from "@/lib/money/plan";
import { describe, nextDate, addDays } from "@/lib/money/schedule";

export default function ScheduleDetail() {
  const { id } = useParams<{ id: string }>();
  const store = useStore();
  const { state, ready } = store;
  const [editing, setEditing] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  if (!ready) return null;
  const s = state.schedules.find((x) => x.id === id);
  if (!s) return <Missing what="schedule" back="/transfers" backLabel="Back to transfers" />;
  const r = state.recipients.find((x) => x.id === s.recipientId);
  const today = new Date().toISOString().slice(0, 10);
  const history = state.activity.filter((a) => a.scheduleId === s.id);
  const unit = s.token === "USDT" ? "USD₮" : "cNGN";
  const live = s.status === "active" || s.status === "paused";
  const n1 = live ? nextDate(s, today) : null;
  const n2 = n1 ? nextDate(s, addDays(n1, 1)) : null;
  const set = (patch: Partial<typeof s>) => store.upsertSchedule({ ...s, ...patch, updatedAt: new Date().toISOString() });

  return (
    <div className="mx-auto max-w-[760px] lg:mx-0">
      <div className="px-4 pt-4 text-[13px] sm:px-6 lg:px-8 lg:pt-8"><Link href="/transfers" className="inline-flex items-center gap-1 text-muted hover:text-ink"><Icon name="back" size={15} />transfers</Link></div>
      <PageBar title={<span>To {r?.name ?? "removed recipient"}</span>} sub={describe(s)} />
      <div className="space-y-5 px-4 pb-10 sm:px-6 lg:px-8">
        {editing ? (
          <>
            <p className="px-1 text-[12.5px] text-muted">The recipient can&rsquo;t be changed. To send to someone else, cancel this and schedule a new transfer.</p>
            <ScheduleFields initial={s} lockStart={s.firstDate < today} submitLabel="Save changes" onBack={() => setEditing(false)} onSubmit={(d) => { set(d); setEditing(false); }} />
          </>
        ) : (
          <>
            <section className="panel">
              <div className="flex items-start justify-between gap-3 px-4 py-4">
                <div>
                  <Amount value={s.amount} token={s.token} className="figure block text-[28px]" />
                  <div className="mt-1 text-[13px] text-muted">{n1 ? `Next: ${date(n1)}${n2 ? ` · then ${date(n2, "day")}` : ""}` : "No more transfers"}</div>
                </div>
                <span className={`pill ${s.status === "active" ? "pill-green" : s.status === "paused" ? "pill-amber" : ""}`}>{s.status}</span>
              </div>
              {r && <div className="border-t rule px-4 py-3"><div className="mb-1.5 text-[12.5px] text-muted">{r.name}&rsquo;s address</div><AddressBlock address={r.address} /></div>}
              <dl className="rows border-t rule text-[13.5px]">
                <Row k="Started">{date(s.firstDate)}</Row>
                <Row k="Ends">{s.frequency === "once" ? "After one transfer" : s.endDate ? date(s.endDate) : "When you cancel"}</Row>
                <Row k="Sent so far">{sentTotal(state.activity, s.id).toLocaleString("en-US")} {unit}{s.maxTotal ? ` of ${Number(s.maxTotal).toLocaleString("en-US")} max` : ""}</Row>
                <Row k="Most per transfer">{Number(s.txLimit ?? s.amount).toLocaleString("en-US")} {unit}</Row>
              </dl>
            </section>
            {live && (
              <div className="flex flex-wrap gap-2">
                <button className="btn btn-ghost" onClick={() => set({ status: s.status === "active" ? "paused" : "active" })}>{s.status === "active" ? "Pause" : "Resume"}</button>
                <button className="btn btn-ghost" onClick={() => setEditing(true)}>Edit</button>
                {!confirmCancel ? (
                  <button className="btn btn-quiet text-alert" onClick={() => setConfirmCancel(true)}>Cancel schedule</button>
                ) : (
                  <span className="flex items-center gap-2 text-[13px]">Cancel all future transfers?<button className="btn btn-danger btn-sm" onClick={() => { set({ status: "cancelled" }); for (const a of state.activity.filter((x) => x.scheduleId === s.id && x.status === "awaiting_approval")) store.patchActivity(a.id, { status: "cancelled" }); setConfirmCancel(false); }}>Yes, cancel</button><button className="btn btn-quiet btn-sm" onClick={() => setConfirmCancel(false)}>Keep</button></span>
                )}
              </div>
            )}
            <section>
              <h2 className="section-title mb-2 px-1">transfers</h2>
              <div className="panel">{history.length ? <ActivityRows items={history} /> : <p className="px-4 py-4 text-[13px] text-muted">None yet. The first goes out {n1 ? date(n1) : "on its date"}, while subscan is open.</p>}</div>
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
