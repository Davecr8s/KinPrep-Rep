import type Stripe from "stripe";
import { z } from "zod";
import { GRACE_DAYS, PLANS, TRIAL_DAYS } from "@/config/pricing";
import type { SubscriptionStatus } from "@/lib/rules/access";
import { DEFAULT_BILLING } from "./billing-settings";
import {
  CurrencySchema,
  intervalOf,
  isPerSeat,
  PLAN_LABELS,
  PlanIdSchema,
  priceFor,
} from "./plans";
import {
  WebhookSignatureError,
  type BillingStore,
  type BillingUpdate,
  type PaymentProvider,
  type SubscriptionPatch,
} from "./types";

/** The slice of the Stripe SDK this provider uses (the real client satisfies it). */
export type StripeApi = {
  checkout: {
    sessions: {
      create(params: Stripe.Checkout.SessionCreateParams): Promise<Stripe.Checkout.Session>;
    };
  };
  subscriptions: {
    retrieve(id: string): Promise<Stripe.Subscription>;
    update(id: string, params: Stripe.SubscriptionUpdateParams): Promise<Stripe.Subscription>;
    cancel(id: string): Promise<Stripe.Subscription>;
  };
  billingPortal: {
    sessions: {
      create(
        params: Stripe.BillingPortal.SessionCreateParams,
      ): Promise<Stripe.BillingPortal.Session>;
    };
  };
  webhooks: {
    constructEventAsync(payload: string, header: string, secret: string): Promise<Stripe.Event>;
  };
};

// Metadata we attach to every Checkout session and subscription.
const MetadataSchema = z
  .object({
    plan: PlanIdSchema,
    student_id: z.uuid().optional(),
    group_account_id: z.uuid().optional(),
    ambassador_id: z.uuid().optional(),
    payer_id: z.uuid().optional(),
    referral_code: z.string().optional(),
  })
  .refine((m) => Boolean(m.student_id) !== Boolean(m.group_account_id));

type KinPrepMetadata = z.infer<typeof MetadataSchema>;

const DAY_SECONDS = 24 * 60 * 60;

function iso(unixSeconds: number | null | undefined): string | null {
  return typeof unixSeconds === "number" && Number.isFinite(unixSeconds)
    ? new Date(unixSeconds * 1000).toISOString()
    : null;
}

function idOf(value: string | { id: string } | null | undefined): string | undefined {
  if (!value) return undefined;
  return typeof value === "string" ? value : value.id;
}

/** Null for subscriptions KinPrep did not create (no or invalid metadata): those are ignored. */
function parseMetadata(metadata: Stripe.Metadata | null | undefined): KinPrepMetadata | null {
  const result = MetadataSchema.safeParse(metadata ?? {});
  return result.success ? result.data : null;
}

function identity(meta: KinPrepMetadata): SubscriptionPatch {
  return {
    plan: meta.plan,
    ...(meta.student_id ? { student_id: meta.student_id } : {}),
    ...(meta.group_account_id ? { group_account_id: meta.group_account_id } : {}),
    ...(meta.ambassador_id ? { ambassador_id: meta.ambassador_id } : {}),
    ...(meta.payer_id ? { payer_id: meta.payer_id } : {}),
    ...(meta.referral_code ? { referral_code: meta.referral_code } : {}),
  };
}

export function mapStripeStatus(status: Stripe.Subscription.Status): SubscriptionStatus {
  switch (status) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "past_due":
      return "past_due";
    case "canceled":
      return "canceled";
    // Retries exhausted but not canceled: the grace period set at the first failure runs out.
    case "unpaid":
      return "past_due";
    case "incomplete_expired":
      return "canceled";
    default:
      // incomplete, paused and any future status: no access.
      return "incomplete";
  }
}

function periodEndOf(subscription: Stripe.Subscription): number | null {
  const ends = subscription.items.data.map((item) => item.current_period_end);
  return ends.length > 0 ? Math.max(...ends) : null;
}

function fromSubscription(subscription: Stripe.Subscription): SubscriptionPatch | null {
  const meta = parseMetadata(subscription.metadata);
  if (!meta) return null;
  const status = mapStripeStatus(subscription.status);
  return {
    ...identity(meta),
    provider_subscription_id: subscription.id,
    provider_customer_id: idOf(subscription.customer),
    currency: CurrencySchema.parse(subscription.currency.toUpperCase()),
    status,
    current_period_end: iso(periodEndOf(subscription)),
    trial_end: iso(subscription.trial_end),
    cancel_at_period_end: subscription.cancel_at_period_end,
    canceled_at: iso(subscription.canceled_at),
    ...(meta.group_account_id ? { seats: subscription.items.data[0]?.quantity ?? 1 } : {}),
    // Back in good standing: clear any grace period from an earlier failure.
    ...(status === "active" || status === "trialing" ? { grace_until: null } : {}),
  };
}

function invoiceContext(invoice: Stripe.Invoice) {
  const details = invoice.parent?.subscription_details;
  const subscriptionId = idOf(details?.subscription);
  const meta = parseMetadata(details?.metadata);
  if (!subscriptionId || !meta) return null;
  const periods = invoice.lines.data.map((line) => line.period);
  return {
    meta,
    patch: {
      ...identity(meta),
      provider_subscription_id: subscriptionId,
      provider_customer_id: idOf(invoice.customer),
      currency: CurrencySchema.parse(invoice.currency.toUpperCase()),
      ...(meta.group_account_id ? { seats: invoice.lines.data[0]?.quantity ?? 1 } : {}),
    } satisfies SubscriptionPatch,
    periodStart: periods.length > 0 ? Math.min(...periods.map((p) => p.start)) : null,
    periodEnd: periods.length > 0 ? Math.max(...periods.map((p) => p.end)) : null,
  };
}

/**
 * Turns a verified Stripe event into a billing update, or null if KinPrep doesn't act on it.
 * `api` is only used to load the subscription for checkout.session.completed.
 */
export async function stripeEventToUpdate(
  event: Stripe.Event,
  api: Pick<StripeApi, "subscriptions">,
  graceDays: number = GRACE_DAYS,
): Promise<BillingUpdate | null> {
  const base = {
    provider: "stripe" as const,
    event_id: event.id,
    event_type: event.type,
    occurred_at: iso(event.created)!,
    payload: event,
  };

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      const subscriptionId = idOf(session.subscription);
      if (session.mode !== "subscription" || !subscriptionId) return null;
      const subscription = await api.subscriptions.retrieve(subscriptionId);
      const patch = fromSubscription(subscription);
      if (!patch) return null;
      const email = session.customer_details?.email;
      return { ...base, subscription: { ...patch, ...(email ? { payer_email: email } : {}) } };
    }

    case "customer.subscription.updated": {
      const patch = fromSubscription(event.data.object);
      return patch ? { ...base, subscription: patch } : null;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object;
      const patch = fromSubscription(subscription);
      if (!patch) return null;
      const endedAt = subscription.ended_at ?? event.created;
      const periodEnd = periodEndOf(subscription);
      return {
        ...base,
        subscription: {
          ...patch,
          status: "canceled",
          // Access stops when the subscription actually ended (immediately for an immediate cancel).
          current_period_end: iso(periodEnd === null ? endedAt : Math.min(periodEnd, endedAt)),
          canceled_at: iso(subscription.canceled_at ?? endedAt),
        },
      };
    }

    case "invoice.paid": {
      const invoice = event.data.object;
      const context = invoiceContext(invoice);
      if (!context) return null;
      const paid = invoice.amount_paid > 0;
      return {
        ...base,
        subscription: {
          ...context.patch,
          current_period_end: iso(context.periodEnd),
          grace_until: null,
          // A £0 trial invoice is "paid" too; only real money makes a subscription active.
          ...(paid ? { status: "active" as const } : {}),
        },
        ...(paid
          ? {
              payment: {
                provider_payment_id: invoice.id,
                status: "succeeded" as const,
                amount_minor: invoice.amount_paid,
                currency: context.patch.currency,
                period_start: iso(context.periodStart) ?? undefined,
                period_end: iso(context.periodEnd) ?? undefined,
                channel: "card",
              },
            }
          : {}),
      };
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object;
      const context = invoiceContext(invoice);
      if (!context) return null;
      return {
        ...base,
        subscription: {
          ...context.patch,
          status: "past_due",
          grace_until: iso(event.created + graceDays * DAY_SECONDS),
        },
        payment: {
          provider_payment_id: `${invoice.id}:attempt:${invoice.attempt_count}`,
          status: "failed",
          amount_minor: invoice.amount_due,
          currency: context.patch.currency,
          channel: "card",
        },
      };
    }

    default:
      return null;
  }
}

export function createStripeProvider(deps: {
  api: StripeApi;
  store: BillingStore;
  webhookSecret: string;
}): PaymentProvider {
  const { api, store, webhookSecret } = deps;

  return {
    id: "stripe",

    async createCheckout(input) {
      const { target, planId, currency } = input;
      const billing = (await store.billingSettings?.()) ?? DEFAULT_BILLING;
      if (PLANS[planId].region === "nigeria" || input.channel === "bank_transfer_or_ussd") {
        throw new Error("Naira plans are paid through Paystack or Manual, not Stripe");
      }
      if (isPerSeat(planId) !== (target.kind === "group")) {
        throw new Error("Per-seat plans are for group buyers, and only per-seat plans are");
      }
      const metadata: Record<string, string> = {
        plan: planId,
        ...(target.kind === "student"
          ? { student_id: target.studentId }
          : { group_account_id: target.groupAccountId }),
        ...(input.referral
          ? { ambassador_id: input.referral.ambassadorId, referral_code: input.referral.code }
          : {}),
        ...(input.payerId ? { payer_id: input.payerId } : {}),
      };
      const session = await api.checkout.sessions.create({
        mode: "subscription",
        line_items: [
          {
            quantity: target.kind === "group" ? target.seats : 1,
            price_data: {
              currency: currency.toLowerCase(),
              unit_amount: priceFor(planId, currency, billing.prices),
              recurring: { interval: intervalOf(planId) },
              product_data: { name: PLAN_LABELS[planId] },
            },
          },
        ],
        subscription_data: {
          metadata,
          ...(input.trial ? { trial_period_days: TRIAL_DAYS } : {}),
        },
        metadata,
        client_reference_id: target.kind === "student" ? target.studentId : target.groupAccountId,
        ...(input.payerEmail ? { customer_email: input.payerEmail } : {}),
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
      });
      if (!session.url) throw new Error("Stripe did not return a Checkout URL");
      return { kind: "redirect", url: session.url, reference: session.id };
    },

    async handleWebhook({ rawBody, headers }) {
      const signature = headers.get("stripe-signature");
      if (!signature) throw new WebhookSignatureError("Missing Stripe-Signature header");
      let event: Stripe.Event;
      try {
        event = await api.webhooks.constructEventAsync(rawBody, signature, webhookSecret);
      } catch {
        throw new WebhookSignatureError();
      }
      const billing = (await store.billingSettings?.()) ?? DEFAULT_BILLING;
      const update = await stripeEventToUpdate(event, api, billing.graceDays);
      if (!update) return { status: "ignored", eventId: event.id };
      return { status: await store.applyBillingEvent(update), eventId: event.id };
    },

    async cancel(subscription, context) {
      if (!subscription.providerSubscriptionId) {
        throw new Error("This subscription has no Stripe subscription id");
      }
      if (context?.immediately) {
        await api.subscriptions.cancel(subscription.providerSubscriptionId);
        return;
      }
      // Ends at the close of the period already paid for; the deleted webhook then follows.
      await api.subscriptions.update(subscription.providerSubscriptionId, {
        cancel_at_period_end: true,
      });
    },

    async getManageLink(subscription, returnUrl) {
      if (!subscription.providerCustomerId) return null;
      const session = await api.billingPortal.sessions.create({
        customer: subscription.providerCustomerId,
        return_url: returnUrl,
      });
      return session.url;
    },
  };
}
