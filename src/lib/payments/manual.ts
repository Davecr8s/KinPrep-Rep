import { randomBytes } from "node:crypto";
import { z } from "zod";
import { CurrencySchema, PlanIdSchema, priceFor } from "./plans";
import type { BillingStore, BillingUpdate, PaymentProvider } from "./types";

// Manual: the payer sends a bank transfer and an admin records it with the period it covers.
// Used in the pilot before a Nigerian entity (and so a live Paystack account) exists.

export const ManualPaymentSchema = z
  .object({
    target: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("student"), studentId: z.uuid() }),
      z.object({
        kind: z.literal("group"),
        groupAccountId: z.uuid(),
        seats: z.int().positive().max(10_000),
      }),
    ]),
    planId: PlanIdSchema,
    currency: CurrencySchema,
    amountMinor: z.int().positive(),
    paidAt: z.coerce.date(),
    periodStart: z.coerce.date(),
    periodEnd: z.coerce.date(),
    /** The bank's transaction reference; recording the same reference twice changes nothing. */
    bankReference: z.string().trim().min(3).max(64),
    note: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.periodEnd > v.periodStart, {
    message: "The period must end after it starts",
    path: ["periodEnd"],
  })
  .refine(
    (v) => {
      try {
        priceFor(v.planId, v.currency);
        return true;
      } catch {
        return false;
      }
    },
    { message: "That plan is not sold in that currency", path: ["currency"] },
  );

export type ManualPayment = z.input<typeof ManualPaymentSchema>;

export function manualPaymentToUpdate(
  input: ManualPayment,
  adminId: string,
  now: Date = new Date(),
): BillingUpdate {
  const payment = ManualPaymentSchema.parse(input);
  const target =
    payment.target.kind === "student"
      ? { student_id: payment.target.studentId }
      : { group_account_id: payment.target.groupAccountId, seats: payment.target.seats };
  const details = {
    bank_reference: payment.bankReference,
    amount_minor: payment.amountMinor,
    currency: payment.currency,
    period_start: payment.periodStart.toISOString(),
    period_end: payment.periodEnd.toISOString(),
  };
  return {
    provider: "manual",
    event_id: `manual:${payment.bankReference}`,
    event_type: "manual.payment_recorded",
    occurred_at: now.toISOString(),
    payload: { ...details, plan: payment.planId, recorded_by: adminId },
    subscription: {
      ...target,
      plan: payment.planId,
      currency: payment.currency,
      extend: { from: payment.periodStart.toISOString(), until: payment.periodEnd.toISOString() },
    },
    payment: {
      provider_payment_id: payment.bankReference,
      status: "succeeded",
      amount_minor: payment.amountMinor,
      currency: payment.currency,
      occurred_at: payment.paidAt.toISOString(),
      channel: "manual_transfer",
      recorded_by: adminId,
      ...(payment.note ? { note: payment.note } : {}),
    },
    audit: { actor_id: adminId, action: "payment.manual_recorded", details },
  };
}

/** Admin action: records a bank transfer. Returns "duplicate" if the reference was already used. */
export async function recordManualPayment(
  store: BillingStore,
  input: ManualPayment,
  adminId: string,
): Promise<"applied" | "duplicate"> {
  return store.applyBillingEvent(manualPaymentToUpdate(input, adminId));
}

const REFERENCE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** A short reference for the payer to quote on their transfer, e.g. KP-7QXM2D4H. */
export function newTransferReference(): string {
  const bytes = randomBytes(8);
  return `KP-${Array.from(bytes, (b) => REFERENCE_ALPHABET[b % REFERENCE_ALPHABET.length]).join("")}`;
}

export function createManualProvider(deps: { store: BillingStore }): PaymentProvider {
  const { store } = deps;
  return {
    id: "manual",

    async createCheckout(input) {
      priceFor(input.planId, input.currency);
      return { kind: "manual", reference: newTransferReference() };
    },

    async handleWebhook() {
      // Manual payments come from the admin console, never from a webhook.
      return { status: "ignored" };
    },

    async cancel(subscription, context) {
      if (!context?.actorId) throw new Error("Cancelling a manual subscription needs an admin");
      const now = new Date().toISOString();
      await store.applyBillingEvent({
        provider: "manual",
        event_id: `manual:cancel:${subscription.id}:${now}`,
        event_type: "manual.subscription_canceled",
        occurred_at: now,
        payload: { subscription_id: subscription.id, canceled_by: context.actorId },
        // Keeps the period already paid for, then ends (see coverageWindow).
        subscription: { id: subscription.id, status: "canceled", canceled_at: now },
        audit: { actor_id: context.actorId, action: "subscription.manual_canceled" },
      });
    },

    async getManageLink() {
      return null;
    },
  };
}
