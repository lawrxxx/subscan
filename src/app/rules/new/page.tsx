"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { RuleForm } from "@/components/rule-form";
import { Icon, PageBar } from "@/components/ui";
import Link from "next/link";
import { useStore } from "@/lib/db/store";
import { syncPolicy } from "@/lib/money/policy";

export default function NewRule() {
  const store = useStore();
  const router = useRouter();
  const [err, setErr] = useState<string>();
  if (!store.ready) return null;
  return (
    <div className="mx-auto max-w-[680px] lg:mx-0">
      <div className="px-4 pt-4 text-[13px] sm:px-6 lg:px-8 lg:pt-8"><Link href="/rules" className="inline-flex items-center gap-1 text-muted hover:text-ink"><Icon name="back" size={15} />money rules</Link></div>
      <PageBar title="new money rule" />
      <div className="px-4 pb-10 sm:px-6 lg:px-8">
        {err && <p className="callout callout-red mb-3 block text-[13px]" role="alert">{err}</p>}
        <RuleForm
          onCancel={() => router.push("/rules")}
          onSave={async (r) => {
            store.upsertRule(r);
            if (r.kind === "transfer_cap") await syncPolicy(store).catch((e) => setErr(`Saved here, but the server's limit couldn't be updated: ${(e as Error).message}`));
            router.push(`/rules/${r.id}`);
          }}
        />
      </div>
    </div>
  );
}
