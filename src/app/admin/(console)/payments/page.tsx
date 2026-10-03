import type { Metadata } from "next";
import Link from "next/link";
import { Card, Notice, styles } from "@/components/ui";
import { CURRENCIES, PLANS } from "@/config/pricing";
import { ledger } from "@/lib/admin/money";
import { providerDashboardUrl } from "@/lib/admin/rules";
import { stripeTestMode } from "@/lib/admin/server";
import { requireAdmin } from "@/lib/auth";
import { appSql } from "@/lib/db/postgres";
import { formatMoney } from "@/lib/money";
import { PLAN_LABELS } from "@/lib/payments/plans";
import { recordManualPaymentAction } from "../actions";

export const metadata: Metadata = { title: "Payments" };

const STATUSES = ["succeeded", "failed", "refunded"];
const PROVIDERS = ["stripe", "paystack", "manual"];

export default async function PaymentsPage({ searchParams }: PageProps<"/admin/payments">) {
  await requireAdmin("/admin/payments");
  const query = await searchParams;
  const pick = (k: string, allowed: string[]) =>
    typeof query[k] === "string" && allowed.includes(query[k] as string)
      ? (query[k] as string)
      : undefined;
  const status = pick("status", STATUSES);
  const provider = pick("provider", PROVIDERS);
  const sql = appSql();
  const [rows, failed] = await Promise.all([
    ledger(sql, { status, provider }),
    ledger(sql, { status: "failed", limit: 20 }),
  ]);
  const test = stripeTestMode();
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-bold text-navy-dark">Payments</h1>
      {typeof query.error === "string" && <Notice tone="warn">{query.error}</Notice>}
      {typeof query.done === "string" && <Notice tone="good">{query.done}</Notice>}

      <section aria-labelledby="failed">
        <h2 id="failed" className="mb-2 text-lg font-bold text-navy-dark">
          Failed payments
        </h2>
        {failed.length === 0 ? (
          <p className={styles.hint}>None.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {failed.map((p) => (
              <li key={p.id}>
                {new Date(p.occurred_at).toISOString().slice(0, 10)} ·{" "}
                {formatMoney(p.amount_minor, p.currency)} · {p.provider} · {p.student ?? "–"} (
                {p.payer_email ?? "no email"})
              </li>
            ))}
          </ul>
        )}
      </section>

      <Card>
        <h2 className="mb-2 text-lg font-bold text-navy-dark">Record a bank transfer (Manual)</h2>
        <form action={recordManualPaymentAction} className="grid gap-3 md:grid-cols-3">
          <label className="flex flex-col gap-1">
            <span className={styles.label}>Student id</span>
            <input name="studentId" required placeholder="from Students" className={styles.input} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={styles.label}>Plan</span>
            <select name="planId" className={styles.input}>
              {Object.keys(PLANS)
                .filter((p) => p !== "bulk_seat_monthly")
                .map((p) => (
                  <option key={p} value={p}>
                    {PLAN_LABELS[p as keyof typeof PLAN_LABELS]} ({p})
                  </option>
                ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className={styles.label}>Currency and amount</span>
            <span className="flex gap-2">
              <select name="currency" defaultValue="NGN" className={styles.input}>
                {CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
              <input
                name="amount"
                required
                inputMode="decimal"
                placeholder="2000"
                className={styles.input}
              />
            </span>
          </label>
          <label className="flex flex-col gap-1">
            <span className={styles.label}>Paid on</span>
            <input
              type="date"
              name="paidAt"
              defaultValue={today}
              required
              className={styles.input}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={styles.label}>Covers from</span>
            <input
              type="date"
              name="periodStart"
              defaultValue={today}
              required
              className={styles.input}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={styles.label}>Covers until</span>
            <input type="date" name="periodEnd" required className={styles.input} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={styles.label}>Bank reference</span>
            <input
              name="bankReference"
              required
              minLength={3}
              maxLength={64}
              className={styles.input}
            />
          </label>
          <label className="flex flex-col gap-1 md:col-span-2">
            <span className={styles.label}>Note (optional)</span>
            <input name="note" maxLength={500} className={styles.input} />
          </label>
          <button className={`${styles.primaryButton} md:col-span-3`}>Record payment</button>
        </form>
      </Card>

      <section aria-labelledby="ledger">
        <h2 id="ledger" className="mb-2 text-lg font-bold text-navy-dark">
          Ledger
        </h2>
        <form action="/admin/payments" className="mb-2 flex flex-wrap gap-2">
          <select
            name="status"
            defaultValue={status ?? ""}
            className={styles.input}
            aria-label="Status"
          >
            <option value="">Any status</option>
            {STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <select
            name="provider"
            defaultValue={provider ?? ""}
            className={styles.input}
            aria-label="Provider"
          >
            <option value="">Any provider</option>
            {PROVIDERS.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
          <button className={styles.secondaryButton}>Show</button>
        </form>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-navy-dark/70">
              <tr>
                <th className="py-2 pr-3">Date</th>
                <th className="py-2 pr-3">Amount</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Provider</th>
                <th className="py-2 pr-3">Student / payer</th>
                <th className="py-2 pr-3">Ambassador</th>
                <th className="py-2">Refund</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const url = providerDashboardUrl(p.provider, p.provider_payment_id, {
                  stripeTestMode: test,
                });
                return (
                  <tr key={p.id} className="border-t border-navy/10">
                    <td className="py-2 pr-3">
                      {new Date(p.occurred_at).toISOString().slice(0, 10)}
                    </td>
                    <td className="py-2 pr-3">{formatMoney(p.amount_minor, p.currency)}</td>
                    <td
                      className={`py-2 pr-3 ${p.status === "failed" ? "font-bold text-red-700" : ""}`}
                    >
                      {p.status}
                    </td>
                    <td className="py-2 pr-3">
                      {p.provider} {p.channel && `(${p.channel})`}
                    </td>
                    <td className="py-2 pr-3">
                      {p.student_id ? (
                        <Link href={`/admin/students/${p.student_id}`} className={styles.link}>
                          {p.student}
                        </Link>
                      ) : (
                        "–"
                      )}{" "}
                      {p.payer_email}
                    </td>
                    <td className="py-2 pr-3">{p.ambassador ?? ""}</td>
                    <td className="py-2">
                      {url ? (
                        <a href={url} target="_blank" rel="noreferrer" className={styles.link}>
                          Open in {p.provider === "stripe" ? "Stripe" : "Paystack"}
                        </a>
                      ) : (
                        <span className={styles.hint}>refund by bank transfer</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
