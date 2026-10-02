import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isSponsorCodeShape } from "@/lib/payments/codes";
import { getBillingStore } from "@/lib/payments/server";

export const metadata: Metadata = {
  title: "Thank you",
  robots: { index: false, follow: false },
};

export default async function SponsorThanksPage({ params }: PageProps<"/sponsor/[code]/thanks">) {
  const { code } = await params;
  if (!isSponsorCodeShape(code)) notFound();
  const student = await getBillingStore().findSponsorLink(code);
  if (!student) notFound();

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-8">
      <p className="text-sm font-semibold tracking-wide text-navy uppercase">KinPrep</p>
      <h1 className="mt-2 text-3xl font-bold text-navy-dark">Thank you!</h1>
      <p className="mt-4 text-lg">
        {student.firstName}&apos;s coaching is being set up now. Stripe will email your receipt.
      </p>
      <p className="mt-4 text-base text-navy-dark/80">
        {student.firstName} practises daily. You&apos;ll see the proof every Sunday.
      </p>
    </main>
  );
}
