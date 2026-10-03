import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TRIAL_DAYS } from "@/config/pricing";
import { getStudentAccess } from "@/lib/access";
import { formatMoney } from "@/lib/money";
import { isSponsorCodeShape } from "@/lib/payments/codes";
import { DEFAULT_BILLING } from "@/lib/payments/billing-settings";
import { priceFor } from "@/lib/payments/plans";
import { getBillingStore } from "@/lib/payments/server";
import { withinLimit } from "@/lib/security/server";
import { TooManyRequests } from "@/components/too-many";
import { startSponsorCheckout } from "./actions";

export const metadata: Metadata = {
  title: "Sponsor a student",
  // Private link: keep it out of search engines.
  robots: { index: false, follow: false },
};

const CURRENCIES = ["GBP", "USD", "CAD"] as const;
type SponsorCurrency = (typeof CURRENCIES)[number];

const EXAM_NAMES: Record<string, string> = {
  BECE: "BECE",
  WASSCE: "WASSCE (WAEC)",
  NECO: "NECO",
  UTME: "UTME (JAMB)",
};

const ERRORS: Record<string, string> = {
  referral: "That referral code isn't valid. Check it, or leave it blank.",
  checkout: "We couldn't open the payment page. Please try again in a moment.",
  form: "Please choose a plan and currency.",
  covered: "Good news: this student's coaching is already paid for.",
  rate: "Too many attempts from this connection. Please wait a few minutes and try again.",
};

function pickCurrency(
  query: string | string[] | undefined,
  country: string | null,
): SponsorCurrency {
  const fromQuery = CURRENCIES.find((c) => c === query);
  if (fromQuery) return fromQuery;
  if (country === "US") return "USD";
  if (country === "CA") return "CAD";
  return "GBP";
}

export default async function SponsorPage({ params, searchParams }: PageProps<"/sponsor/[code]">) {
  const { code } = await params;
  const query = await searchParams;
  if (!isSponsorCodeShape(code)) notFound();
  if (!(await withinLimit("sponsorView"))) return <TooManyRequests />;
  const student = await getBillingStore().findSponsorLink(code);
  if (!student) notFound();

  const access = await getStudentAccess(student.studentId);
  const currency = pickCurrency(query.currency, (await headers()).get("x-vercel-ip-country"));
  const error = typeof query.error === "string" ? ERRORS[query.error] : undefined;
  const { prices } = (await getBillingStore().billingSettings?.()) ?? DEFAULT_BILLING;
  const monthly = priceFor("abroad_monthly", currency, prices);
  const yearly = priceFor("abroad_yearly", currency, prices);
  const yearlySaving = monthly * 12 - yearly;

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-8">
      <p className="text-sm font-semibold tracking-wide text-navy uppercase">KinPrep</p>
      <h1 className="mt-2 text-3xl font-bold text-navy-dark">Sponsor {student.firstName}</h1>
      <p className="mt-2 text-lg">
        {student.className} · preparing for {EXAM_NAMES[student.exam] ?? student.exam}
      </p>
      <p className="mt-4 text-base text-navy-dark/80">
        {student.firstName} practises exam questions every day. You get a progress report every
        Sunday showing what they did.
      </p>

      {error && (
        <p role="alert" className="mt-6 rounded-lg bg-orange-light px-4 py-3 text-navy-dark">
          {error}
        </p>
      )}

      {access.state === "active" ? (
        <p className="mt-8 rounded-lg border-2 border-navy px-4 py-4 text-lg">
          {student.firstName}&apos;s coaching is already paid for. Thank you for thinking of them!
        </p>
      ) : (
        <form action={startSponsorCheckout.bind(null, code)} className="mt-8 flex flex-col gap-6">
          <fieldset>
            <legend className="font-semibold">Pay in</legend>
            <div className="mt-2 flex gap-2">
              {CURRENCIES.map((c) => (
                <Link
                  key={c}
                  href={`/sponsor/${code}?currency=${c}`}
                  replace
                  scroll={false}
                  aria-current={c === currency ? "true" : undefined}
                  className={`rounded-full border-2 px-4 py-2 font-semibold ${
                    c === currency ? "border-navy bg-navy text-white" : "border-navy/30 text-navy"
                  }`}
                >
                  {c}
                </Link>
              ))}
            </div>
            <input type="hidden" name="currency" value={currency} />
          </fieldset>

          <fieldset className="flex flex-col gap-3">
            <legend className="font-semibold">Choose a plan</legend>
            <label className="flex cursor-pointer items-center gap-3 rounded-lg border-2 border-navy/30 px-4 py-3 has-checked:border-navy">
              <input
                type="radio"
                name="plan"
                value="abroad_monthly"
                defaultChecked
                className="size-5 accent-navy"
              />
              <span>
                <span className="block font-semibold">
                  {formatMoney(monthly, currency)} a month
                </span>
                <span className="text-sm text-navy-dark/70">Cancel any time</span>
              </span>
            </label>
            <label className="flex cursor-pointer items-center gap-3 rounded-lg border-2 border-navy/30 px-4 py-3 has-checked:border-navy">
              <input
                type="radio"
                name="plan"
                value="abroad_yearly"
                className="size-5 accent-navy"
              />
              <span>
                <span className="block font-semibold">{formatMoney(yearly, currency)} a year</span>
                <span className="text-sm text-navy-dark/70">
                  Save {formatMoney(yearlySaving, currency)} compared with monthly
                </span>
              </span>
            </label>
          </fieldset>

          <label className="flex flex-col gap-1">
            <span className="font-semibold">Referral code (optional)</span>
            <input
              name="referral"
              autoComplete="off"
              autoCapitalize="characters"
              maxLength={40}
              className="rounded-lg border-2 border-navy/30 px-4 py-3 uppercase focus:border-navy focus:outline-none"
            />
          </label>

          <button
            type="submit"
            className="rounded-full bg-orange px-6 py-4 text-lg font-bold text-navy-dark hover:brightness-95"
          >
            Continue to secure payment
          </button>
          <p className="text-sm text-navy-dark/70">
            {TRIAL_DAYS}-day free trial for new students. Payment by card through Stripe; KinPrep
            never sees or stores your card details.
          </p>
        </form>
      )}
    </main>
  );
}
