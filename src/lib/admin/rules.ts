import { AMBASSADOR_COMMISSION, PLANS, type Currency, type PlanId } from "@/config/pricing";
import type { GoStopMeasure } from "@/config/pilot";
import type { PriceTable } from "@/lib/payments/plans";
import { addDays, type Day } from "@/lib/rules/days";

// Pure rules for the admin console: revenue maths, go/stop status, ambassador commission, and
// the pilot console's WhatsApp links. Unit tested in admin.test.ts.

/** What a subscription brings in a month, in minor units of its currency. */
export function monthlyEquivalent(
  planId: string,
  currency: Currency,
  seats: number | null,
  prices: PriceTable,
): number {
  if (!(planId in PLANS)) return 0;
  const plan = PLANS[planId as PlanId];
  const price = prices[planId as PlanId][currency] ?? 0;
  const perMonth =
    plan.interval === "year" ? price / 12 : plan.interval === "week" ? (price * 52) / 12 : price;
  return Math.round(perMonth * (seats ?? 1));
}

export type MeasureStatus = "go" | "stop" | "watch";

/** Against the brief's go/stop lines: at or above go, below stop, or in between. */
export function measureStatus(measure: GoStopMeasure, value: number): MeasureStatus {
  if (value >= measure.go) return "go";
  if (measure.stopBelow !== undefined && value < measure.stopBelow) return "stop";
  return "watch";
}

/** Months after the payer's first payment in which their payments earn commission. */
export function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

export type CommissionPayment = {
  paymentId: string;
  ambassadorId: string;
  currency: Currency;
  amountMinor: number;
  occurredAt: Date;
  /** The payer's first successful payment with KinPrep. */
  payerFirstPaidAt: Date;
};

/** 20% (in basis points, rounded down to the minor unit) of one payment. */
export function commissionOn(amountMinor: number): number {
  return Math.floor((amountMinor * AMBASSADOR_COMMISSION.rateBps) / 10_000);
}

/** A payment earns commission if it falls in the payer's first three months. */
export function earnsCommission(p: CommissionPayment): boolean {
  return (
    p.occurredAt >= p.payerFirstPaidAt &&
    p.occurredAt < addMonths(p.payerFirstPaidAt, AMBASSADOR_COMMISSION.firstMonths)
  );
}

export type PayoutLine = {
  ambassadorId: string;
  currency: Currency;
  amountMinor: number;
  items: { paymentId: string; amountMinor: number }[];
};

/** One line per ambassador and currency, from the payments that earn commission. */
export function payoutLines(payments: readonly CommissionPayment[]): PayoutLine[] {
  const lines = new Map<string, PayoutLine>();
  for (const p of payments) {
    if (!earnsCommission(p)) continue;
    const amount = commissionOn(p.amountMinor);
    if (amount <= 0) continue;
    const key = `${p.ambassadorId}:${p.currency}`;
    const line = lines.get(key) ?? {
      ambassadorId: p.ambassadorId,
      currency: p.currency,
      amountMinor: 0,
      items: [],
    };
    line.amountMinor += amount;
    line.items.push({ paymentId: p.paymentId, amountMinor: amount });
    lines.set(key, line);
  }
  return [...lines.values()].sort(
    (a, b) => a.ambassadorId.localeCompare(b.ambassadorId) || a.currency.localeCompare(b.currency),
  );
}

/** The first day of a Lagos month and of the next, as Lagos days. */
export function monthBounds(month: string): { start: Day; next: Day } {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return { start, next };
}

/** The Lagos month a Lagos day is in, as "YYYY-MM". */
export function monthOf(day: Day): string {
  return day.slice(0, 7);
}

/** The month before, as "YYYY-MM". */
export function previousMonth(month: string): string {
  return monthOf(addDays(`${monthBounds(month).start}`, -1));
}

/** wa.me link that opens WhatsApp with the message ready to send to `phone`. */
export function waMeLink(phone: string, text: string): string {
  return `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;
}

/**
 * A queued template's preview, as text an admin sends by hand: the button's link becomes a line
 * of its own; a quick-reply button (which a hand-sent message can't have) is dropped.
 */
export function handSentText(preview: string): string {
  return preview
    .replace(/ \[([^\]:]+): (https?:\/\/[^\]\s]+)\]$/, "\n\n$1: $2")
    .replace(/ \[[^\]]+\]$/, "");
}

/** Where to refund or inspect a payment in the provider's own dashboard. */
export function providerDashboardUrl(
  provider: string,
  providerPaymentId: string,
  options: { stripeTestMode: boolean },
): string | null {
  const id = encodeURIComponent(providerPaymentId);
  if (provider === "stripe") {
    return `https://dashboard.stripe.com/${options.stripeTestMode ? "test/" : ""}search?query=${id}`;
  }
  if (provider === "paystack") {
    return `https://dashboard.paystack.com/#/search?model=transactions&query=${id}`;
  }
  return null;
}
