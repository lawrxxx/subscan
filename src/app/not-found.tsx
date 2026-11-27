import Link from "next/link";

export default function NotFound() {
  return (
    <div className="px-4 py-16 sm:px-6 lg:px-8">
      <div className="label mb-3">404</div>
      <h1 className="title max-w-xl text-[30px]">This page doesn&rsquo;t exist.</h1>
      <p className="mt-2 max-w-md text-[14px] text-muted">The link may be out of date, or the payment was removed.</p>
      <div className="mt-6 flex gap-2">
        <Link href="/" className="btn btn-primary">Back to overview</Link>
        <Link href="/payments" className="btn btn-ghost">Payments</Link>
      </div>
    </div>
  );
}
