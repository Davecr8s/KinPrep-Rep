import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, Notice, styles } from "@/components/ui";
import { getBatch } from "@/lib/admin/money";
import { requireAdmin } from "@/lib/auth";
import { appSql } from "@/lib/db/postgres";
import { formatMoney } from "@/lib/money";
import { batchAction } from "../../../actions";

export const metadata: Metadata = { title: "Payout batch" };

const METHOD = {
  paystack: "Paystack Transfer",
  stripe_connect: "Stripe Connect",
  manual: "By hand",
};

// Check the amounts, then confirm: Paystack and Stripe lines are paid at once; manual lines are
// marked as paid when the money has gone.
export default async function BatchPage({
  params,
  searchParams,
}: PageProps<"/admin/ambassadors/batches/[id]">) {
  const { id } = await params;
  await requireAdmin(`/admin/ambassadors/batches/${id}`);
  const query = await searchParams;
  const batch = await getBatch(appSql(), id);
  if (!batch) notFound();
  const action = batchAction.bind(null, id);
  return (
    <div className="flex flex-col gap-4">
      <Link href="/admin/ambassadors" className={styles.link}>
        Ambassadors
      </Link>
      <h1 className="text-2xl font-bold text-navy-dark">
        Commission payouts for {batch.month} · {batch.status}
      </h1>
      {typeof query.error === "string" && <Notice tone="warn">{query.error}</Notice>}
      {typeof query.done === "string" && <Notice tone="good">{query.done}</Notice>}
      <ul className="flex flex-col gap-2">
        {batch.payouts.map((p) => (
          <li key={p.id}>
            <Card className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-semibold">
                  {p.name} ({p.code}): {formatMoney(p.amount_minor, p.currency)}
                </p>
                <p className="text-sm text-navy-dark/80">
                  {METHOD[p.method]}{" "}
                  {p.destination
                    ? `to ${p.destination}`
                    : p.method !== "manual"
                      ? "· no payout account on file"
                      : ""}{" "}
                  · {p.payments} payments · <strong>{p.status}</strong>
                  {p.provider_ref && ` · ref ${p.provider_ref}`}
                  {p.error && <span className="text-red-700"> · {p.error}</span>}
                </p>
              </div>
              {batch.status === "confirmed" && p.status !== "paid" && (
                <form action={action} className="flex gap-2">
                  <input type="hidden" name="action" value="mark-paid" />
                  <input type="hidden" name="payoutId" value={p.id} />
                  <input
                    name="reference"
                    required
                    minLength={2}
                    placeholder="Transfer reference"
                    aria-label="Transfer reference"
                    className={styles.input}
                  />
                  <button className={styles.secondaryButton}>Mark as paid</button>
                </form>
              )}
            </Card>
          </li>
        ))}
      </ul>
      {batch.status === "prepared" && (
        <Card className="flex flex-col gap-3">
          <form action={action} className="flex flex-col gap-2">
            <input type="hidden" name="action" value="confirm" />
            <label className="flex gap-3">
              <input
                type="checkbox"
                name="checked"
                required
                className="mt-1 size-5 shrink-0 accent-navy"
              />
              <span>I have checked these amounts and accounts. Pay them now.</span>
            </label>
            <button className={styles.primaryButton}>Confirm and pay</button>
          </form>
          <form action={action}>
            <input type="hidden" name="action" value="discard" />
            <button className={styles.dangerButton}>Discard this batch</button>
          </form>
        </Card>
      )}
    </div>
  );
}
