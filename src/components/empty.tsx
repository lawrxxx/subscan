"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/db/store";

/** Empty state used across pages: import your own statement, or explore with labelled sample data. */
export function NoData({ kicker, title, children }: { kicker: string; title: string; children?: ReactNode }) {
  const { enterDemo } = useStore();
  const router = useRouter();
  return (
    <div className="grid border-b rule lg:grid-cols-[1.2fr_1fr]">
      <div className="px-4 py-14 sm:px-8 lg:border-r lg:rule lg:px-12 lg:py-24">
        <div className="kicker mb-4">{kicker}</div>
        <h1 className="display max-w-xl text-[44px] sm:text-[60px]">{title}</h1>
        <p className="mt-4 max-w-md text-[16px] text-muted">{children ?? "Upload a bank or card statement (PDF or CSV) and subscan will find every bill and subscription in it."}</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/onboarding" className="btn btn-primary">Upload a statement</Link>
          <button className="btn btn-ghost" onClick={() => { enterDemo(); router.push("/"); }}>Try demo mode</button>
        </div>
        <p className="mt-3 max-w-md text-[12px] text-muted">Demo mode uses a made-up sample statement, kept completely separate from anything you upload. Leave it any time.</p>
      </div>
      <div className="hidden bg-paper-2/60 px-10 py-24 lg:block">
        <div className="kicker mb-4">What you&rsquo;ll see</div>
        <ol className="space-y-5">
          {[
            ["Every bill, found", "Subscriptions, utilities, rent, loans and insurance — detected from how often and how much you pay."],
            ["What’s already committed", "How much of your income is spoken for, what’s due before payday, and what you could cut."],
            ["An agent that helps", "Ask about your bills in plain language. It prepares payments; nothing moves until you approve."],
          ].map(([t, d], i) => (
            <li key={t} className="grid grid-cols-[28px_1fr] border-t rule pt-4">
              <span className="num text-[12px] text-faint">0{i + 1}</span>
              <div>
                <div className="display text-[21px]">{t}</div>
                <div className="mt-1 text-[13px] text-muted">{d}</div>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

export function Missing({ what, back, backLabel }: { what: string; back: string; backLabel: string }) {
  return (
    <div className="px-4 py-20 sm:px-8 lg:px-12">
      <div className="kicker mb-4">Not found</div>
      <h1 className="display max-w-xl text-[44px] sm:text-[56px]">That {what} isn&rsquo;t here any more.</h1>
      <p className="mt-3 max-w-md text-[15px] text-muted">It may have been removed when you re-imported a statement or cleared your data.</p>
      <Link href={back} className="btn btn-primary mt-8">{backLabel}</Link>
    </div>
  );
}
