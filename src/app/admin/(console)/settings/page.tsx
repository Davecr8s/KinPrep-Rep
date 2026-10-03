import type { Metadata } from "next";
import { Card, Notice, styles } from "@/components/ui";
import { QUESTIONS_PER_DAY } from "@/config/pilot";
import { PLANS, type Currency, type PlanId } from "@/config/pricing";
import { readSettings } from "@/lib/admin/console";
import { requireAdmin } from "@/lib/auth";
import { appSql } from "@/lib/db/postgres";
import { formatMoney } from "@/lib/money";
import { MAX_GRACE_DAYS } from "@/lib/payments/billing-settings";
import { CONFIG_PRICES, PLAN_LABELS } from "@/lib/payments/plans";
import { saveSettingsAction } from "../actions";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage({ searchParams }: PageProps<"/admin/settings">) {
  await requireAdmin("/admin/settings");
  const query = await searchParams;
  const s = await readSettings(appSql());
  const number = (
    name: string,
    label: string,
    value: number,
    min: number,
    max: number,
    hint: string,
  ) => (
    <label className="flex flex-col gap-1">
      <span className={styles.label}>{label}</span>
      <input
        type="number"
        name={name}
        defaultValue={value}
        min={min}
        max={max}
        required
        className={styles.input}
      />
      <span className={styles.hint}>{hint}</span>
    </label>
  );

  return (
    <form action={saveSettingsAction} className="flex flex-col gap-5">
      <h1 className="text-2xl font-bold text-navy-dark">Settings</h1>
      {typeof query.error === "string" && <Notice tone="warn">{query.error}</Notice>}
      {typeof query.done === "string" && <Notice tone="good">{query.done}</Notice>}
      <Card className="grid gap-4 md:grid-cols-3">
        {number(
          "questionsPerDay",
          "Questions per day",
          s.questionsPerDay,
          1,
          QUESTIONS_PER_DAY.max,
          `1 to ${QUESTIONS_PER_DAY.max}; the pilot uses 10.`,
        )}
        {number(
          "streakThreshold",
          "Answers for a streak day",
          s.streakThreshold,
          1,
          20,
          "A Lagos day counts at this many answers.",
        )}
        {number(
          "graceDays",
          "Grace days after a failed payment",
          s.billing.graceDays,
          0,
          MAX_GRACE_DAYS,
          "Applies to new failures and late renewals.",
        )}
        <label className="flex items-center gap-3 md:col-span-3">
          <input
            type="checkbox"
            name="reminderEnabled"
            defaultChecked={s.reminderEnabled}
            className="size-5 accent-navy"
          />
          <span>
            <span className={styles.label}>18:00 reminder</span>{" "}
            <span className={styles.hint}>to opted-in seniors who haven&apos;t started today</span>
          </span>
        </label>
        {number(
          "waPerSecond",
          "WhatsApp messages per second",
          s.waPerSecond,
          1,
          80,
          "Stay well inside Meta's limit.",
        )}
        {number(
          "waPerDay",
          "WhatsApp messages per day",
          s.waPerDay,
          1,
          100_000,
          "Meta's limit for the number (250 to start).",
        )}
      </Card>
      <Card>
        <h2 className="mb-1 text-lg font-bold text-navy-dark">Prices</h2>
        <p className={`${styles.hint} mb-3`}>
          In pounds, dollars or naira. New checkouts and pages use them straight away.
          Paystack&apos;s recurring card plans keep their own amount: after changing a naira price,
          create new Paystack plans (npm run paystack:plans) and update PAYSTACK_PLAN_* in Vercel.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          {(Object.keys(PLANS) as PlanId[]).map((plan) => (
            <fieldset key={plan} className="rounded-lg border border-navy/10 p-3">
              <legend className="px-1 font-semibold">{PLAN_LABELS[plan]}</legend>
              <div className="flex flex-wrap gap-3">
                {(Object.keys(PLANS[plan].prices) as Currency[]).map((currency) => {
                  const current = s.billing.prices[plan][currency]!;
                  const config = CONFIG_PRICES[plan][currency]!;
                  return (
                    <label key={currency} className="flex flex-col gap-1">
                      <span className="text-sm">{currency}</span>
                      <input
                        name={`price:${plan}:${currency}`}
                        defaultValue={(current / 100).toFixed(2)}
                        inputMode="decimal"
                        required
                        className={`${styles.input} max-w-32`}
                      />
                      {current !== config && (
                        <span className="text-xs text-navy-dark/70">
                          config: {formatMoney(config, currency)}
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>
      </Card>
      <button className={styles.primaryButton}>Save settings</button>
    </form>
  );
}
