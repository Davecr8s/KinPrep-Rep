import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { GRACE_DAYS, PLANS, type PlanId } from "@/config/pricing";
import { CurrencySchema, PlanIdSchema, pgIntervalOf, priceFor } from "./plans";
import {
  WebhookSignatureError,
  type BillingStore,
  type BillingUpdate,
  type PaymentProvider,
  type SubscriptionPatch,
} from "./types";

// Paystack takes naira. Cards renew automatically through Paystack subscriptions. Bank transfer
// and USSD can't be charged again without the payer, so each of those payments buys one period
// (pay-per-period) and the 3-day grace period covers late renewals.

export type PaystackPlanCodes = Partial<Record<"nigeria_weekly" | "nigeria_monthly", string>>;

const PAYSTACK_API = "https://api.paystack.co";
const DAY_MS = 24 * 60 * 60 * 1000;

export function verifyPaystackSignature(
  rawBody: string,
  signature: string | null,
  secretKey: string,
): boolean {
  if (!signature) return false;
  const expected = Buffer.from(
    createHmac("sha512", secretKey).update(rawBody, "utf8").digest("hex"),
    "hex",
  );
  const given = Buffer.from(signature, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const MetadataSchema = z.object({
  kind: z.enum(["subscription", "period"]),
  plan: PlanIdSchema,
  student_id: z.uuid().optional(),
  group_account_id: z.uuid().optional(),
  ambassador_id: z.uuid().optional(),
  referral_code: z.string().optional(),
});
type PaystackMetadata = z.infer<typeof MetadataSchema>;

const CustomerSchema = z.looseObject({
  customer_code: z.string(),
  email: z.string().nullish(),
});

const EnvelopeSchema = z.object({ event: z.string(), data: z.looseObject({}) });

const ChargeSchema = z.looseObject({
  id: z.union([z.number(), z.string()]),
  reference: z.string(),
  amount: z.number().int().nonnegative(),
  currency: z.string(),
  paid_at: z.string().nullish(),
  paidAt: z.string().nullish(),
  created_at: z.string().nullish(),
  channel: z.string().nullish(),
  metadata: z.unknown().optional(),
  customer: CustomerSchema,
  plan: z.unknown().optional(),
});

const SubscriptionSchema = z.looseObject({
  subscription_code: z.string(),
  status: z.string().nullish(),
  email_token: z.string().nullish(),
  next_payment_date: z.string().nullish(),
  createdAt: z.string().nullish(),
  updatedAt: z.string().nullish(),
  plan: z.looseObject({ plan_code: z.string() }),
  customer: CustomerSchema,
});

const InvoiceSchema = z.looseObject({
  id: z.union([z.number(), z.string()]).nullish(),
  invoice_code: z.string().nullish(),
  amount: z.number().int().nonnegative(),
  currency: z.string().nullish(),
  createdAt: z.string().nullish(),
  updatedAt: z.string().nullish(),
  subscription: z.looseObject({ subscription_code: z.string() }),
});

function parseMetadata(raw: unknown): PaystackMetadata | null {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  const result = MetadataSchema.safeParse(value);
  return result.success ? result.data : null;
}

function planCodeOf(plan: unknown): string | undefined {
  const result = z.object({ plan_code: z.string().min(1) }).safeParse(plan);
  return result.success ? result.data.plan_code : undefined;
}

/** The first parseable timestamp among the candidates, else `now`. */
function firstDate(now: Date, ...candidates: (string | null | undefined)[]): string {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const date = new Date(candidate);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return now.toISOString();
}

function identity(meta: PaystackMetadata): SubscriptionPatch {
  return {
    plan: meta.plan,
    ...(meta.student_id ? { student_id: meta.student_id } : {}),
    ...(meta.group_account_id ? { group_account_id: meta.group_account_id } : {}),
    ...(meta.ambassador_id ? { ambassador_id: meta.ambassador_id } : {}),
    ...(meta.referral_code ? { referral_code: meta.referral_code } : {}),
  };
}

/** Turns a verified Paystack webhook into a billing update, or null if KinPrep doesn't act on it. */
export function paystackEventToUpdate(
  body: unknown,
  rawBody: string,
  planCodes: PaystackPlanCodes,
  now: Date = new Date(),
): BillingUpdate | null {
  const envelope = EnvelopeSchema.safeParse(body);
  if (!envelope.success) return null;
  const { event, data } = envelope.data;
  // Paystack events have no id of their own; key each one by the object it is about.
  const fallbackId = createHash("sha256").update(rawBody).digest("hex");
  const planIdForCode = (code: string): PlanId | undefined =>
    (Object.keys(planCodes) as (keyof PaystackPlanCodes)[]).find((id) => planCodes[id] === code);

  switch (event) {
    case "charge.success": {
      const charge = ChargeSchema.parse(data);
      const meta = parseMetadata(charge.metadata);
      const occurredAt = firstDate(now, charge.paid_at, charge.paidAt, charge.created_at);
      const currency = CurrencySchema.parse(charge.currency.toUpperCase());
      const base = {
        provider: "paystack" as const,
        event_id: `${event}:${charge.id}`,
        event_type: event,
        occurred_at: occurredAt,
        payload: body,
        payment: {
          provider_payment_id: String(charge.id),
          status: "succeeded" as const,
          amount_minor: charge.amount,
          currency,
          channel: charge.channel ?? undefined,
        },
      };
      const customer = {
        provider_customer_id: charge.customer.customer_code,
        ...(charge.customer.email ? { payer_email: charge.customer.email } : {}),
      };

      if (meta?.kind === "period") {
        return {
          ...base,
          subscription: {
            ...identity(meta),
            ...customer,
            currency,
            extend: { from: occurredAt, by: pgIntervalOf(meta.plan) },
          },
        };
      }

      const planCode = planCodeOf(charge.plan);
      const planId = planCode ? (planIdForCode(planCode) ?? meta?.plan) : undefined;
      if (!planId) return null;
      const extend = { from: occurredAt, by: pgIntervalOf(planId) };

      if (meta?.kind === "subscription") {
        // First charge from our checkout. Paystack creates the subscription afterwards
        // (subscription.create), which then replaces this pending id with the real code.
        return {
          ...base,
          subscription: {
            ...identity(meta),
            ...customer,
            plan: planId,
            currency,
            provider_subscription_id: `pending:${charge.reference}`,
            extend,
          },
        };
      }
      // A renewal Paystack charged by itself: find the subscription by customer and plan.
      return {
        ...base,
        subscription: {
          match_customer: { customer_id: customer.provider_customer_id, plan: planId },
          extend,
        },
      };
    }

    case "subscription.create":
    case "subscription.disable": {
      const subscription = SubscriptionSchema.parse(data);
      const planId = planIdForCode(subscription.plan.plan_code);
      if (!planId) return null;
      const occurredAt = firstDate(now, subscription.updatedAt, subscription.createdAt);
      const match = {
        customer_id: subscription.customer.customer_code,
        plan: planId,
        pending_only: true,
      };
      const patch: SubscriptionPatch =
        event === "subscription.create"
          ? {
              provider_subscription_id: subscription.subscription_code,
              match_customer: match,
              status: "active",
              grace_until: null,
              ...(subscription.next_payment_date
                ? { current_period_end: firstDate(now, subscription.next_payment_date) }
                : {}),
              ...(subscription.email_token
                ? { provider_meta: { email_token: subscription.email_token } }
                : {}),
            }
          : {
              provider_subscription_id: subscription.subscription_code,
              match_customer: match,
              // Keeps the time already paid for (see coverageWindow), then ends.
              status: "canceled",
              canceled_at: occurredAt,
            };
      return {
        provider: "paystack",
        event_id: `${event}:${subscription.subscription_code}`,
        event_type: event,
        occurred_at: occurredAt,
        payload: body,
        subscription: patch,
      };
    }

    case "invoice.payment_failed": {
      const invoice = InvoiceSchema.parse(data);
      const occurredAt = firstDate(now, invoice.updatedAt, invoice.createdAt);
      const key = invoice.invoice_code ?? (invoice.id != null ? String(invoice.id) : fallbackId);
      return {
        provider: "paystack",
        event_id: `${event}:${key}`,
        event_type: event,
        occurred_at: occurredAt,
        payload: body,
        subscription: {
          provider_subscription_id: invoice.subscription.subscription_code,
          status: "past_due",
          grace_until: new Date(new Date(occurredAt).getTime() + GRACE_DAYS * DAY_MS).toISOString(),
        },
        payment: {
          provider_payment_id: `invoice:${key}:failed`,
          status: "failed",
          amount_minor: invoice.amount,
          currency: CurrencySchema.parse((invoice.currency ?? "NGN").toUpperCase()),
        },
      };
    }

    default:
      return null;
  }
}

const InitializeResponseSchema = z.object({
  status: z.literal(true),
  data: z.object({ authorization_url: z.url(), reference: z.string() }),
});
const ManageLinkResponseSchema = z.object({
  status: z.literal(true),
  data: z.object({ link: z.url() }),
});

export function createPaystackProvider(deps: {
  secretKey: string;
  planCodes: PaystackPlanCodes;
  store: BillingStore;
  fetch?: typeof fetch;
}): PaymentProvider {
  const { secretKey, planCodes, store } = deps;
  const doFetch = deps.fetch ?? fetch;

  async function call(method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> {
    const response = await doFetch(`${PAYSTACK_API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const json: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const message = z.object({ message: z.string() }).safeParse(json);
      throw new Error(
        `Paystack ${path} failed: ${message.success ? message.data.message : response.status}`,
      );
    }
    return json;
  }

  return {
    id: "paystack",

    async createCheckout(input) {
      const { target, planId } = input;
      if (PLANS[planId].region !== "nigeria") {
        throw new Error("Paystack only takes the naira plans");
      }
      if (target.kind !== "student") throw new Error("Group seats are paid through Stripe");
      if (!input.payerEmail) throw new Error("Paystack needs the payer's email address");
      const card = (input.channel ?? "card") === "card";
      const planCode = planCodes[planId as keyof PaystackPlanCodes];
      if (card && !planCode) throw new Error(`No Paystack plan code configured for ${planId}`);

      const reference = `kp_${randomUUID().replaceAll("-", "")}`;
      const json = await call("POST", "/transaction/initialize", {
        email: input.payerEmail,
        amount: priceFor(planId, "NGN"),
        currency: "NGN",
        reference,
        callback_url: input.successUrl,
        channels: card ? ["card"] : ["bank_transfer", "ussd"],
        ...(card ? { plan: planCode } : {}),
        metadata: {
          kind: card ? "subscription" : "period",
          plan: planId,
          student_id: target.studentId,
          ...(input.referral
            ? { ambassador_id: input.referral.ambassadorId, referral_code: input.referral.code }
            : {}),
          cancel_action: input.cancelUrl,
        },
      });
      const { data } = InitializeResponseSchema.parse(json);
      return { kind: "redirect", url: data.authorization_url, reference: data.reference };
    },

    async handleWebhook({ rawBody, headers }) {
      if (!verifyPaystackSignature(rawBody, headers.get("x-paystack-signature"), secretKey)) {
        throw new WebhookSignatureError();
      }
      const update = paystackEventToUpdate(JSON.parse(rawBody), rawBody, planCodes);
      if (!update) return { status: "ignored" };
      return { status: await store.applyBillingEvent(update), eventId: update.event_id };
    },

    async cancel(subscription) {
      const code = subscription.providerSubscriptionId;
      // Pay-per-period coverage never renews by itself, so there is nothing to cancel.
      if (!code) return;
      const token = subscription.providerMeta.email_token;
      if (code.startsWith("pending:") || typeof token !== "string") {
        throw new Error("Paystack has not confirmed this subscription yet; try again shortly");
      }
      await call("POST", "/subscription/disable", { code, token });
    },

    async getManageLink(subscription) {
      const code = subscription.providerSubscriptionId;
      if (!code || code.startsWith("pending:")) return null;
      const json = await call("GET", `/subscription/${encodeURIComponent(code)}/manage/link`);
      return ManageLinkResponseSchema.parse(json).data.link;
    },
  };
}
