"use client";
import Link from "next/link";

export function Missing({ what, back, backLabel }: { what: string; back: string; backLabel: string }) {
  return (
    <div className="px-4 py-16 sm:px-6 lg:px-8">
      <div className="label mb-3">Not found</div>
      <h1 className="title max-w-xl text-[30px]">That {what} isn&rsquo;t here any more.</h1>
      <p className="mt-2 max-w-md text-[14px] text-muted">It may have been deleted, or it was saved in a different browser.</p>
      <Link href={back} className="btn btn-primary mt-6">{backLabel}</Link>
    </div>
  );
}
