"use client";
import Link from "next/link";
import { EmptyPanel, Icon, PageBar } from "@/components/ui";
import { useStore } from "@/lib/db/store";
import { ruleSummary } from "@/lib/money/rules";

export default function Rules() {
  const { state, ready } = useStore();
  if (!ready) return null;
  const rules = [...state.rules].sort((a, b) => (a.status === b.status ? a.createdAt.localeCompare(b.createdAt) : a.status === "active" ? -1 : 1));
  return (
    <div>
      <PageBar title="money rules" sub="tell subscan how to keep your money" actions={rules.length ? <Link href="/rules/new" className="btn btn-primary"><Icon name="plus" size={16} />add a rule</Link> : undefined} />
      <div className="mx-auto max-w-[760px] space-y-4 px-4 sm:px-6 lg:mx-0 lg:px-8">
        {!rules.length ? (
          <section className="panel">
            <EmptyPanel icon="rules" title="No money rules yet" action={<Link href="/rules/new" className="btn btn-primary">Add your first rule</Link>}>
              For example: keep at least 50,000 cNGN ready, convert 20 USD₮ when naira runs low, keep 30% in dollars, or cap any automated transfer.
            </EmptyPanel>
          </section>
        ) : (
          <section className="panel">
            <ul className="rows">
              {rules.map((r) => (
                <li key={r.id}>
                  <Link href={`/rules/${r.id}`} className="row">
                    <span className="flex min-w-0 items-center gap-3">
                      <span className={`tile ${r.status === "paused" ? "text-muted" : ""}`}><Icon name={r.status === "paused" ? "pause" : "rules"} size={17} /></span>
                      <span className="min-w-0">
                        <span className="flex min-w-0 items-center gap-2"><span className="row-title">{r.name}</span>{r.status === "paused" && <span className="pill shrink-0">paused</span>}{r.askFirst && r.status === "active" && <span className="pill pill-plain shrink-0">asks first</span>}</span>
                        <span className="row-sub">{ruleSummary(r)}</span>
                      </span>
                    </span>
                    <Icon name="chev" size={16} className="chev" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
        {state.autopilot?.sealedPolicy ? null : rules.length > 0 && <p className="callout callout-amber block text-[13px]">These rules can&rsquo;t run until subscan has access to your payment wallet. <Link href="/payment-wallet" className="font-semibold underline underline-offset-2">Set it up</Link>.</p>}
        <p className="px-1 text-[12.5px] text-muted">Rules are checked every minute while subscan is open in a browser. They don&rsquo;t run while it&rsquo;s closed.</p>
      </div>
    </div>
  );
}
