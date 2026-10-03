import type { Metadata } from "next";
import Link from "next/link";
import { FieldError, Notice, styles } from "@/components/ui";
import { CONSENT_POINTS } from "@/lib/consent";
import { findConsentRequest } from "@/lib/services/students";
import { acceptConsent } from "./actions";

export const metadata: Metadata = {
  title: "Parent or guardian consent",
  robots: { index: false, follow: false },
};

export default async function GuardianConsentPage({
  params,
  searchParams,
}: PageProps<"/consent/[token]">) {
  const { token } = await params;
  const query = await searchParams;

  if (query.done === "1") {
    return (
      <Shell>
        <h1 className="text-3xl font-bold text-navy-dark">Thank you</h1>
        <p className="mt-3 text-lg">
          Your consent is recorded. Your child can start practising now.
        </p>
      </Shell>
    );
  }

  const request = await findConsentRequest(token);
  if (!request) {
    return (
      <Shell>
        <h1 className="text-3xl font-bold text-navy-dark">This link has expired</h1>
        <p className="mt-3 text-lg">
          It may have been used already or replaced by a newer link. Ask the person who sent it for
          a new one.
        </p>
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 className="text-3xl font-bold text-navy-dark">
        {request.firstName} ({request.className}) has been signed up for KinPrep
      </h1>
      <p className="mt-3 text-lg">
        KinPrep gives secondary-school students daily exam practice for WAEC, NECO and JAMB, with
        questions checked by teachers. As {request.firstName}&apos;s parent or guardian, we need
        your agreement before they start.
      </p>
      <h2 className="mt-6 text-xl font-bold">You agree that:</h2>
      <ul className="mt-2 list-disc pl-5 text-navy-dark/90">
        {CONSENT_POINTS.map((p) => (
          <li key={p} className="mt-1">
            {p}
          </li>
        ))}
      </ul>
      <p className="text-sm">
        How we use and protect this:{" "}
        <Link href="/privacy" target="_blank" className="underline">
          privacy notice
        </Link>
        .
      </p>
      <form action={acceptConsent.bind(null, token)} className="mt-6 flex flex-col gap-4">
        <label className="flex cursor-pointer gap-3">
          <input type="checkbox" name="agree" className="mt-1 size-5 shrink-0 accent-navy" />
          <span className="font-semibold">
            I am {request.firstName}&apos;s parent or legal guardian and I agree.
          </span>
        </label>
        <FieldError
          message={
            query.error === "tick"
              ? "Tick the box to agree."
              : query.error === "rate"
                ? "Too many attempts. Please wait a few minutes and try again."
                : undefined
          }
        />
        <button type="submit" className={styles.primaryButton}>
          I agree
        </button>
      </form>
      <div className="mt-6">
        <Notice>
          If you don&apos;t agree, simply ignore this page. Nothing will be sent to{" "}
          {request.firstName}.
        </Notice>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-10">
      <p className="mb-8 text-lg font-bold text-navy">
        Kin<span className="text-orange">Prep</span>
      </p>
      {children}
    </main>
  );
}
