"use client";
import { useEffect, useMemo, useState } from "react";
import { ActivityRows } from "@/components/money";
import { Amount, Avatar, EmptyPanel, PageBar } from "@/components/ui";
import Link from "next/link";
import { useStore } from "@/lib/db/store";
import { date } from "@/lib/format";
import { upcoming } from "@/lib/money/plan";
import type { ActivityStatus } from "@/lib/types";

const FILTERS: { id: "all" | "scheduled" | ActivityStatus; label: string }[] = [
  { id: "all", label: "all" },
  { id: "awaiting_approval", label: "needs your OK" },
  { id: "scheduled", label: "scheduled" },
  { id: "processing", label: "processing" },
  { id: "completed", label: "completed" },
  { id: "failed", label: "failed" },
  { id: "cancelled", label: "cancelled" },
];

export default function History() {
  const { state, ready } = useStore();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  useEffect(() => {
    const f = new URLSearchParams(window.location.search).get("filter");
    if (f && FILTERS.some((x) => x.id === f)) setFilter(f as never);
  }, []);
  const today = new Date().toISOString().slice(0, 10);
  const next = useMemo(() => upcoming(state, today, 20).filter((u) => u.schedule.status === "active"), [state, today]);
  if (!ready) return null;
  const items = filter === "all" ? state.activity : filter === "scheduled" ? [] : state.activity.filter((a) => a.status === filter);
  const count = (id: string) => (id === "all" ? state.activity.length : id === "scheduled" ? next.length : state.activity.filter((a) => a.status === id).length);

  return (
    <div>
      <PageBar title="activity" sub="every transfer and conversion, and what happened" />
      <div className="mx-auto max-w-[760px] space-y-4 px-4 sm:px-6 lg:mx-0 lg:px-8">
        <div className="tabs" role="tablist" aria-label="Filter">
          {FILTERS.map((f) => (count(f.id) > 0 || f.id === "all" || f.id === filter) && (
            <button key={f.id} role="tab" aria-selected={filter === f.id} onClick={() => setFilter(f.id)}>{f.label}<span className="count">{count(f.id)}</span></button>
          ))}
        </div>
        {filter === "scheduled" ? (
          <section className="panel">
            {!next.length ? <p className="px-4 py-4 text-[13px] text-muted">Nothing scheduled.</p> : (
              <ul className="rows">
                {next.map((u) => (
                  <li key={`${u.schedule.id}-${u.date}`}>
                    <Link href={`/transfers/${u.schedule.id}`} className="row">
                      <span className="flex min-w-0 items-center gap-3"><Avatar name={u.recipient?.name ?? "?"} size={36} /><span className="min-w-0"><span className="row-title">To {u.recipient?.name ?? "removed recipient"}</span><span className="row-sub">{date(u.date)}</span></span></span>
                      <span className="flex shrink-0 flex-col items-end gap-1"><Amount value={u.schedule.amount} token={u.schedule.token} className="row-amount" /><span className="pill pill-blue">Scheduled</span></span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : !items.length ? (
          <section className="panel"><EmptyPanel icon="history" title={filter === "all" ? "No activity yet" : "Nothing here"}>{filter === "all" ? "Transfers and conversions will appear here with their status and a link to the transaction on Celo." : "Nothing with this status."}</EmptyPanel></section>
        ) : (
          <section className="panel"><ActivityRows items={items} /></section>
        )}
      </div>
    </div>
  );
}
