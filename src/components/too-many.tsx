import Link from "next/link";

/** Shown instead of a public page when one connection has asked for it too often. */
export function TooManyRequests() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-10">
      <Link href="/" className="text-lg font-bold text-navy">
        Kin<span className="text-orange">Prep</span>
      </Link>
      <h1 className="mt-8 text-2xl font-bold text-navy-dark">Please wait a moment</h1>
      <p className="mt-3">
        We&apos;ve had a lot of requests from this connection. Wait a few minutes, then open the
        link again.
      </p>
    </main>
  );
}
