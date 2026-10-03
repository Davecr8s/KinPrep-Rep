import type { Metadata } from "next";
import Link from "next/link";
import { Card, Notice, styles } from "@/components/ui";
import type { Currency } from "@/config/pricing";
import { listAmbassadors, listBatches, payoutPreview, type AmbassadorRow } from "@/lib/admin/money";
import { monthOf, previousMonth } from "@/lib/admin/rules";
import { requireAdmin } from "@/lib/auth";
import { appSql } from "@/lib/db/postgres";
import { formatMoney } from "@/lib/money";
import { lagosDay } from "@/lib/rules/days";
import {
  paystackRecipientAction,
  prepareBatchAction,
  saveAmbassadorAction,
  stripeOnboardingAction,
} from "../actions";

export const metadata: Metadata = { title: "Ambassadors" };

const money = (by: Partial<Record<Currency, number>>) =>
  Object.entries(by)
    .map(([c, v]) => formatMoney(v!, c as Currency))
    .join(" + ") || "–";

function AmbassadorForm({ a }: { a?: AmbassadorRow }) {
  return (
    <form
      action={saveAmbassadorAction.bind(null, a?.id ?? null)}
      className="grid gap-2 md:grid-cols-6"
    >
      <input
        name="name"
        required
        defaultValue={a?.name}
        placeholder="Name"
        aria-label="Name"
        className={`${styles.input} md:col-span-2`}
      />
      <input
        name="code"
        required
        defaultValue={a?.code}
        placeholder="CODE"
        aria-label="Code"
        className={styles.input}
      />
      <input
        name="email"
        type="email"
        defaultValue={a?.email ?? ""}
        placeholder="Email"
        aria-label="Email"
        className={`${styles.input} md:col-span-2`}
      />
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          name="active"
          defaultChecked={a?.active ?? true}
          className="size-5 accent-navy"
        />{" "}
        Active
      </label>
      <select
        name="payoutCountry"
        defaultValue={a?.payout_country ?? "NG"}
        aria-label="Country"
        className={styles.input}
      >
        <option value="NG">Nigeria</option>
        <option value="GB">United Kingdom</option>
      </select>
      <select
        name="payoutMethod"
        defaultValue={a?.payout_method ?? "manual"}
        aria-label="Payout method"
        className={`${styles.input} md:col-span-2`}
      >
        <option value="paystack">Paystack Transfer (Nigerian bank)</option>
        <option value="stripe_connect">Stripe Connect Express (UK)</option>
        <option value="manual">Pay by hand</option>
      </select>
      <button className={`${styles.secondaryButton} md:col-span-3`}>
        {a ? "Save" : "Create code"}
      </button>
    </form>
  );
}

export default async function AmbassadorsPage({ searchParams }: PageProps<"/admin/ambassadors">) {
  await requireAdmin("/admin/ambassadors");
  const query = await searchParams;
  const sql = appSql();
  const now = new Date();
  const lastMonth = previousMonth(monthOf(lagosDay(now)));
  const month =
    typeof query.month === "string" && /^\d{4}-\d{2}$/.test(query.month) ? query.month : lastMonth;
  const [ambassadors, batches, preview] = await Promise.all([
    listAmbassadors(sql, now),
    listBatches(sql),
    payoutPreview(sql, month),
  ]);
  const name = (id: string) => ambassadors.find((a) => a.id === id)?.name ?? id;

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-bold text-navy-dark">Ambassadors</h1>
      <p className={styles.hint}>
        Commission: 20% of each referred payer&apos;s payments in their first three months.
      </p>
      {typeof query.error === "string" && <Notice tone="warn">{query.error}</Notice>}
      {typeof query.done === "string" && <Notice tone="good">{query.done}</Notice>}
      {typeof query.onboarding === "string" && (
        <Notice tone="good">
          Send this Stripe link to {name(String(query.for))} to finish their payout account:{" "}
          <a href={query.onboarding} className={styles.link}>
            {query.onboarding}
          </a>
        </Notice>
      )}

      <ul className="flex flex-col gap-3">
        {ambassadors.map((a) => (
          <li key={a.id}>
            <Card className="flex flex-col gap-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-lg font-bold">
                  {a.name} · <code>{a.code}</code>{" "}
                  {!a.active && <span className="text-red-700">(inactive)</span>}
                </p>
                <p className="text-sm">
                  {a.referred_payers} referred payers · earned {money(a.earned)} · paid{" "}
                  {money(a.paid)}
                </p>
              </div>
              <AmbassadorForm a={a} />
              {a.payout_method === "paystack" && (
                <form
                  action={paystackRecipientAction.bind(null, a.id)}
                  className="flex flex-wrap items-center gap-2 text-sm"
                >
                  <span>
                    {a.paystack_recipient_code
                      ? `Paying to ${a.bank_name} ••••${a.account_last4}. Change:`
                      : "Bank account for Paystack Transfers:"}
                  </span>
                  <input
                    name="bankCode"
                    required
                    inputMode="numeric"
                    placeholder="Bank code (e.g. 058)"
                    aria-label="Bank code"
                    className={`${styles.input} max-w-40`}
                  />
                  <input
                    name="accountNumber"
                    required
                    inputMode="numeric"
                    placeholder="10-digit account number"
                    aria-label="Account number"
                    className={`${styles.input} max-w-56`}
                  />
                  <button className={styles.secondaryButton}>Register with Paystack</button>
                </form>
              )}
              {a.payout_method === "stripe_connect" && (
                <form
                  action={stripeOnboardingAction.bind(null, a.id)}
                  className="flex flex-wrap items-center gap-2 text-sm"
                >
                  <span>
                    {a.stripe_account_id
                      ? `Stripe account ${a.stripe_account_id}.`
                      : "No Stripe account yet."}
                  </span>
                  <button className={styles.secondaryButton}>
                    {a.stripe_account_id ? "New onboarding link" : "Create Stripe Express account"}
                  </button>
                </form>
              )}
            </Card>
          </li>
        ))}
      </ul>
      <Card>
        <p className="mb-2 font-semibold">New ambassador code</p>
        <AmbassadorForm />
      </Card>

      <section aria-labelledby="payouts">
        <h2 id="payouts" className="mb-2 text-lg font-bold text-navy-dark">
          Monthly payout list
        </h2>
        <form action="/admin/ambassadors" className="mb-2 flex gap-2">
          <input
            type="month"
            name="month"
            defaultValue={month}
            aria-label="Month"
            className={`${styles.input} max-w-48`}
          />
          <button className={styles.secondaryButton}>Show</button>
        </form>
        {preview.length === 0 ? (
          <p className={styles.hint}>Nothing waiting to be paid for {month} or before.</p>
        ) : (
          <Card>
            <ul className="mb-3 text-sm">
              {preview.map((l) => (
                <li key={`${l.ambassadorId}-${l.currency}`}>
                  {name(l.ambassadorId)}: {formatMoney(l.amountMinor, l.currency)} ({l.items.length}{" "}
                  payments)
                </li>
              ))}
            </ul>
            <form action={prepareBatchAction}>
              <input type="hidden" name="month" value={month} />
              <button className={styles.primaryButton}>Prepare the {month} batch</button>
            </form>
          </Card>
        )}
        {batches.length > 0 && (
          <ul className="mt-3 text-sm">
            {batches.map((b) => (
              <li key={b.id}>
                <Link href={`/admin/ambassadors/batches/${b.id}`} className={styles.link}>
                  {b.month} batch
                </Link>{" "}
                · {b.status}
                {b.confirmed_at && ` on ${new Date(b.confirmed_at).toISOString().slice(0, 10)}`}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
