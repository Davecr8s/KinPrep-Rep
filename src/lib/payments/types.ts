import type { Currency, PlanId } from "@/config/pricing";
import type { Coverage, SubscriptionStatus } from "@/lib/rules/access";

export type ProviderId = "stripe" | "paystack" | "manual";
/** Providers as stored on subscriptions: the payment providers plus KinPrep's own free trial. */
export type SubscriptionProvider = ProviderId | "trial";

/** Who a checkout pays for: one student, or a number of seats for a group buyer. */
export type CheckoutTarget =
  { kind: "student"; studentId: string } | { kind: "group"; groupAccountId: string; seats: number };

export type Referral = { ambassadorId: string; code: string };

export type CheckoutInput = {
  target: CheckoutTarget;
  planId: PlanId;
  currency: Currency;
  payerEmail?: string;
  payerId?: string;
  referral?: Referral;
  /** Whether this checkout includes the free trial (first subscription for the student only). */
  trial: boolean;
  /** Paystack only: recurring card subscription, or pay-per-period by transfer or USSD. */
  channel?: "card" | "bank_transfer_or_ussd";
  successUrl: string;
  cancelUrl: string;
};

export type CheckoutResult =
  | { kind: "redirect"; url: string; reference: string }
  /** Manual: the payer transfers money quoting `reference`; an admin then records it. */
  | { kind: "manual"; reference: string };

export type WebhookRequest = { rawBody: string; headers: Headers };

export type WebhookResult = {
  status: "applied" | "duplicate" | "ignored";
  eventId?: string;
};

/** A stored subscription, as providers need it to cancel or manage it. */
export type SubscriptionRecord = {
  id: string;
  provider: SubscriptionProvider;
  providerSubscriptionId: string | null;
  providerCustomerId: string | null;
  providerMeta: Record<string, unknown>;
  status: SubscriptionStatus;
  currentPeriodEnd: Date | null;
};

/** The one interface the rest of the app uses to take and manage payments. */
export interface PaymentProvider {
  readonly id: ProviderId;
  createCheckout(input: CheckoutInput): Promise<CheckoutResult>;
  /** Verifies the signature, then applies the event idempotently. Throws WebhookSignatureError. */
  handleWebhook(request: WebhookRequest): Promise<WebhookResult>;
  /**
   * Stops renewal. By default the time already paid for is kept; `immediately` ends it now
   * (used before deleting a child's data, so nobody is billed for a deleted student).
   */
  cancel(
    subscription: SubscriptionRecord,
    context?: { actorId?: string; immediately?: boolean },
  ): Promise<void>;
  /** A page where the payer can change their card or cancel; null if the provider has none. */
  getManageLink(subscription: SubscriptionRecord, returnUrl: string): Promise<string | null>;
}

export class WebhookSignatureError extends Error {
  constructor(message = "Invalid webhook signature") {
    super(message);
    this.name = "WebhookSignatureError";
  }
}

// ---------------------------------------------------------------------------------------------
// The provider-neutral update applied by public.apply_billing_event (see the billing migration).
// Keys are snake_case because this object is passed to Postgres as-is.

export type SubscriptionPatch = {
  id?: string;
  provider_subscription_id?: string;
  match_customer?: { customer_id: string; plan: PlanId; pending_only?: boolean };
  student_id?: string;
  group_account_id?: string;
  seats?: number;
  plan?: PlanId;
  currency?: Currency;
  provider_customer_id?: string;
  payer_email?: string;
  payer_id?: string;
  ambassador_id?: string;
  referral_code?: string;
  provider_meta?: Record<string, unknown>;
  status?: SubscriptionStatus;
  current_period_end?: string | null;
  trial_end?: string | null;
  grace_until?: string | null;
  cancel_at_period_end?: boolean;
  canceled_at?: string | null;
  extend?: { from: string; by?: string; until?: string };
};

export type PaymentEntry = {
  provider_payment_id: string;
  status: "succeeded" | "failed" | "refunded";
  amount_minor: number;
  currency: Currency;
  occurred_at?: string;
  period_start?: string;
  period_end?: string;
  channel?: string;
  recorded_by?: string;
  note?: string;
};

export type BillingUpdate = {
  provider: SubscriptionProvider;
  event_id: string;
  event_type: string;
  occurred_at: string;
  payload?: unknown;
  subscription?: SubscriptionPatch;
  payment?: PaymentEntry;
  audit?: { actor_id: string; action: string; details?: Record<string, unknown> };
};

/** The data access the payments module needs. Implemented over Supabase (and PGlite in tests). */
import type { BillingSettings } from "./billing-settings";

export interface BillingStore {
  applyBillingEvent(update: BillingUpdate): Promise<"applied" | "duplicate">;
  getCoverages(studentId: string, at: Date): Promise<Coverage[]>;
  /** True if the latest guardian consent event for the student is "granted". */
  hasGuardianConsent(studentId: string): Promise<boolean>;
  /** True while an admin has paused the student. */
  isPaused?(studentId: string): Promise<boolean>;
  /** Prices and grace days from admin settings (defaults: src/config/pricing.ts). */
  billingSettings?(): Promise<BillingSettings>;
  hasAnySubscription(studentId: string): Promise<boolean>;
  getSubscription(id: string): Promise<SubscriptionRecord | null>;
  findSponsorLink(code: string): Promise<SponsoredStudent | null>;
  findActiveAmbassador(code: string): Promise<Referral | null>;
}

/** What a sponsor link may reveal about a student: first name, class and exam only. */
export type SponsoredStudent = {
  studentId: string;
  firstName: string;
  className: string;
  exam: string;
};
