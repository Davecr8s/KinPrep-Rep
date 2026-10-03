import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccessBadge } from "@/components/access-badge";
import { Card, Notice, PageTitle, styles } from "@/components/ui";
import { TRIAL_DAYS, type PlanId } from "@/config/pricing";
import { requirePayer } from "@/lib/auth";
import { getChild } from "@/lib/data/children";
import { manualBankDetails } from "@/lib/data/settings";
import { childAccess } from "@/lib/data/status";
import { formatMoney } from "@/lib/money";
import { DEFAULT_BILLING } from "@/lib/payments/billing-settings";
import { getBillingStore } from "@/lib/payments/server";
import { startPlanCheckout } from "./actions";

export const metadata: Metadata = { title: "Choose a plan" };

const ERRORS: Record<string, string> = {
  form: "Please choose a plan and a way to pay.",
  checkout: "We couldn't open the payment page. Please try again in a moment.",
};

function Option({
  name,
  value,
  title,
  body,
  defaultChecked,
}: {
  name: string;
  value: string;
  title: string;
  body?: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-lg border-2 border-navy/20 px-4 py-3 has-checked:border-navy">
      <input
        type="radio"
        name={name}
        value={value}
        defaultChecked={defaultChecked}
        required
        className="size-5 accent-navy"
      />
      <span>
        <span className="block font-semibold">{title}</span>
        {body && <span className={styles.hint}>{body}</span>}
      </span>
    </label>
  );
}

export default async function PlanPage({
  params,
  searchParams,
}: PageProps<"/app/children/[id]/plan">) {
  const { user, payer } = await requirePayer();
  const { id } = await params;
  const query = await searchParams;
  const child = await getChild(id);
  if (!child || child.owner_id !== user.id) notFound();

  const status = await childAccess(id);
  const { prices } = (await getBillingStore().billingSettings?.()) ?? DEFAULT_BILLING;
  const error = typeof query.error === "string" ? ERRORS[query.error] : undefined;
  const transferRef = typeof query.transfer === "string" ? query.transfer : null;

  if (transferRef) {
    const bank = await manualBankDetails();
    const plan = (
      query.plan === "nigeria_weekly" ? "nigeria_weekly" : "nigeria_monthly"
    ) satisfies PlanId;
    return (
      <>
        <PageTitle>Pay by bank transfer</PageTitle>
        <Card className="flex flex-col gap-3 text-lg">
          <p>
            Transfer <strong>{formatMoney(prices[plan].NGN!, "NGN")}</strong> to:
          </p>
          {bank ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <dt className="text-navy-dark/70">Bank</dt>
              <dd className="font-semibold">{bank.bank}</dd>
              <dt className="text-navy-dark/70">Account name</dt>
              <dd className="font-semibold">{bank.accountName}</dd>
              <dt className="text-navy-dark/70">Account number</dt>
              <dd className="font-semibold tracking-wider">{bank.accountNumber}</dd>
            </dl>
          ) : null}
          <p>
            Use this reference: <strong className="tracking-wider">{transferRef}</strong>
          </p>
          <Notice>
            We&apos;ll confirm your payment within one working day and {child.first_name}&apos;s
            plan will start.
          </Notice>
        </Card>
        <Link href={`/app/children/${id}`} className={`${styles.link} mt-6 block text-center`}>
          Back to {child.first_name}&apos;s page
        </Link>
      </>
    );
  }

  const hadSubscription = await getBillingStore().hasAnySubscription(id);
  const bankTransfer = payer.region === "nigeria" ? await manualBankDetails() : null;
  const currency = payer.currency === "NGN" ? "GBP" : payer.currency;

  return (
    <>
      <PageTitle
        sub={query.new === "1" ? `${child.first_name} is added. Now choose how to pay.` : undefined}
      >
        Plan for {child.first_name}
      </PageTitle>
      <div className="mb-6">
        <AccessBadge {...status} timeZone={payer.timezone} />
      </div>
      {error && (
        <div className="mb-4">
          <Notice tone="warn">{error}</Notice>
        </div>
      )}

      <form action={startPlanCheckout.bind(null, id)} className="flex flex-col gap-6">
        {payer.region === "abroad" ? (
          <>
            <fieldset className="flex flex-col gap-3">
              <legend className={`${styles.label} mb-2`}>Plan</legend>
              <Option
                name="plan"
                value="abroad_monthly"
                defaultChecked
                title={`${formatMoney(prices.abroad_monthly[currency]!, currency)} a month`}
                body="Cancel any time"
              />
              <Option
                name="plan"
                value="abroad_yearly"
                title={`${formatMoney(prices.abroad_yearly[currency]!, currency)} a year`}
                body={`Save ${formatMoney(prices.abroad_monthly[currency]! * 12 - prices.abroad_yearly[currency]!, currency)} a year`}
              />
            </fieldset>
            <input type="hidden" name="currency" value={currency} />
            <p className={styles.hint}>
              {hadSubscription
                ? "Paid by card through Stripe."
                : `${TRIAL_DAYS} days free, then paid by card through Stripe. Cancel before then and you pay nothing.`}{" "}
              KinPrep never sees your card details. Prices in {currency}; change your currency in
              settings.
            </p>
            <button type="submit" className={styles.primaryButton}>
              {hadSubscription ? "Continue to payment" : "Start free trial"}
            </button>
          </>
        ) : (
          <>
            <fieldset className="flex flex-col gap-3">
              <legend className={`${styles.label} mb-2`}>Plan</legend>
              <Option
                name="plan"
                value="nigeria_weekly"
                title={`${formatMoney(prices.nigeria_weekly.NGN!, "NGN")} a week`}
              />
              <Option
                name="plan"
                value="nigeria_monthly"
                defaultChecked
                title={`${formatMoney(prices.nigeria_monthly.NGN!, "NGN")} a month`}
                body="Best value"
              />
            </fieldset>
            <fieldset className="flex flex-col gap-3">
              <legend className={`${styles.label} mb-2`}>How to pay</legend>
              <Option
                name="method"
                value="card"
                defaultChecked
                title="Card"
                body="Renews automatically. Cancel any time."
              />
              <Option
                name="method"
                value="transfer"
                title="Bank transfer or USSD"
                body="Pay each week or month yourself. We'll remind you."
              />
              {bankTransfer && (
                <Option
                  name="method"
                  value="manual"
                  title="Transfer to KinPrep's account"
                  body="We confirm it by hand within one working day."
                />
              )}
            </fieldset>
            <button type="submit" className={styles.primaryButton}>
              Continue to payment
            </button>
          </>
        )}
      </form>
      <Link href={`/app/children/${id}`} className={`${styles.link} mt-6 block text-center`}>
        Not now
      </Link>
    </>
  );
}
