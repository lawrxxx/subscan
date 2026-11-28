"use client";
import { txUrl } from "@/lib/celo/config";
import { shortHash } from "@/lib/format";

export function HashLink({ hash, n = 6 }: { hash: string; n?: number }) {
  return (
    <a href={txUrl(hash)} target="_blank" rel="noreferrer" className="font-mono text-[12px] link">
      {shortHash(hash, n)} ↗
    </a>
  );
}

