import Link from "next/link";

export default function NotFound() {
  return (
    <div className="px-4 py-20 sm:px-8 lg:px-12 lg:py-28">
      <div className="kicker mb-4">404</div>
      <h1 className="display max-w-xl text-[48px] sm:text-[68px]">This page isn&rsquo;t on the statement.</h1>
      <p className="mt-4 max-w-md text-[16px] text-muted">The link may be out of date, or the subscription was removed when you re-imported.</p>
      <div className="mt-8 flex gap-3">
        <Link href="/" className="btn btn-primary">Back to overview</Link>
        <Link href="/subscriptions" className="btn btn-ghost">All subscriptions</Link>
      </div>
    </div>
  );
}
