"use client";
import Link from "next/link";
import { useEffect } from "react";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="px-4 py-16 sm:px-6 lg:px-8">
      <div className="label mb-3 text-alert">Something went wrong</div>
      <h1 className="title max-w-xl text-[30px]">This page hit an error.</h1>
      <p className="mt-3 max-w-md text-[14px] text-muted">{error.message || "An unexpected error occurred."}{error.digest ? ` (ref ${error.digest})` : ""}</p>
      <div className="mt-6 flex gap-2">
        <button className="btn btn-primary" onClick={reset}>Try again</button>
        <Link href="/" className="btn btn-ghost">Overview</Link>
      </div>
    </div>
  );
}
