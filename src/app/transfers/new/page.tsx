"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AddRecipient, RecipientRow } from "@/components/recipients";
import { ScheduleFields, type ScheduleDetails } from "@/components/schedule-form";
import { ScheduleSummary } from "@/components/schedule-summary";
import { Icon, PageBar } from "@/components/ui";
import { useStore } from "@/lib/db/store";
import { syncPolicy } from "@/lib/money/policy";

export default function NewTransfer() {
  const store = useStore();
  const router = useRouter();
  const { state, ready } = store;
  const [step, setStep] = useState<"recipient" | "details" | "summary">("recipient");
  const [recipientId, setRecipientId] = useState<string>();
  const [adding, setAdding] = useState(false);
  const [details, setDetails] = useState<ScheduleDetails>();
  const [err, setErr] = useState<string>();
  if (!ready) return null;
  const confirmed = state.recipients.filter((r) => r.confirmedAt);
  const recipient = state.recipients.find((r) => r.id === recipientId);
  const n = step === "recipient" ? 1 : step === "details" ? 2 : 3;

  return (
    <div className="mx-auto max-w-[640px] lg:mx-0">
      <div className="px-4 pt-4 text-[13px] sm:px-6 lg:px-8 lg:pt-8"><Link href="/transfers" className="inline-flex items-center gap-1 text-muted hover:text-ink"><Icon name="back" size={15} />transfers</Link></div>
      <PageBar title="schedule a transfer" sub={`Step ${n} of 3 · ${step === "recipient" ? "who to send to" : step === "details" ? "how much and when" : "check and activate"}`} />
      <div className="space-y-4 px-4 pb-10 sm:px-6 lg:px-8">
        {err && <p className="callout callout-red block text-[13px]" role="alert">{err}</p>}
        {step === "recipient" &&
          (adding || !confirmed.length ? (
            <AddRecipient
              existing={state.recipients}
              onCancel={() => (confirmed.length ? setAdding(false) : router.push("/transfers"))}
              onDone={async (r) => {
                store.upsertRecipient(r);
                setRecipientId(r.id);
                setAdding(false);
                setStep("details");
                await syncPolicy(store).catch((e) => setErr(`Recipient saved here, but subscan's server couldn't be updated yet: ${(e as Error).message}. Transfers to them will be refused until it is.`));
              }}
            />
          ) : (
            <>
              <div className="panel">
                <ul className="rows">
                  {confirmed.map((r) => (
                    <li key={r.id}>
                      <button className="w-full text-left hover:bg-paper-2/50" onClick={() => { setRecipientId(r.id); setStep("details"); }}>
                        <RecipientRow r={r}><Icon name="chev" size={16} className="chev" /></RecipientRow>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
              <button className="btn btn-ghost w-full" onClick={() => setAdding(true)}><Icon name="plus" size={16} />someone new</button>
            </>
          ))}
        {step === "details" && recipient && (
          <>
            <div className="panel"><RecipientRow r={recipient} /></div>
            <ScheduleFields initial={details} onBack={() => setStep("recipient")} submitLabel="Review" onSubmit={(d) => { setDetails(d); setStep("summary"); }} />
          </>
        )}
        {step === "summary" && recipient && details && (
          <>
            <ScheduleSummary state={state} recipient={recipient} d={details} />
            <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
              <button className="btn btn-ghost" onClick={() => setStep("details")}>Back</button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  const t = new Date().toISOString();
                  const id = `sch_${Date.now().toString(36)}`;
                  store.upsertSchedule({ id, recipientId: recipient.id, ...details, status: "active", createdAt: t, updatedAt: t });
                  router.push(`/transfers/${id}`);
                }}
              >
                Activate schedule
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
