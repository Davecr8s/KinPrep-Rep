import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import { TRIAL_DAYS } from "@/config/pricing";
import {
  createStripeProvider,
  mapStripeStatus,
  stripeEventToUpdate,
  type StripeApi,
} from "./stripe";
import type { BillingStore, CheckoutInput, SubscriptionRecord } from "./types";

const STUDENT = "6f1d6c2e-8a51-4f0e-9d3a-2b7c1e4f5a60";
const AMBASSADOR = "0b9a8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d";

function fakeApi() {
  const api = {
    checkout: {
      sessions: {
        create: vi.fn(async (_params: Stripe.Checkout.SessionCreateParams) => ({
          id: "cs_1",
          url: "https://checkout.stripe.test/cs_1",
        })),
      },
    },
    subscriptions: {
      retrieve: vi.fn(),
      update: vi.fn(async (_id: string, _params: unknown) => ({})),
      cancel: vi.fn(async (_id: string) => ({})),
    },
    billingPortal: {
      sessions: {
        create: vi.fn(async (_params: unknown) => ({ url: "https://billing.stripe.test/p" })),
      },
    },
    webhooks: { constructEventAsync: vi.fn() },
  };
  return { api, typed: api as unknown as StripeApi };
}

const store = {} as BillingStore;

const checkout = (overrides: Partial<CheckoutInput> = {}): CheckoutInput => ({
  target: { kind: "student", studentId: STUDENT },
  planId: "abroad_monthly",
  currency: "USD",
  trial: true,
  successUrl: "https://kinprep.test/thanks",
  cancelUrl: "https://kinprep.test/back",
  ...overrides,
});

describe("Stripe createCheckout", () => {
  it("prices from config, attaches the student and referral, and adds the trial", async () => {
    const { api, typed } = fakeApi();
    const provider = createStripeProvider({ api: typed, store, webhookSecret: "whsec_x" });
    const result = await provider.createCheckout(
      checkout({
        referral: { ambassadorId: AMBASSADOR, code: "TOLA10" },
        payerEmail: "s@example.com",
      }),
    );
    expect(result).toEqual({
      kind: "redirect",
      url: "https://checkout.stripe.test/cs_1",
      reference: "cs_1",
    });
    const params = api.checkout.sessions.create.mock
      .calls[0]![0] as Stripe.Checkout.SessionCreateParams;
    const metadata = {
      plan: "abroad_monthly",
      student_id: STUDENT,
      ambassador_id: AMBASSADOR,
      referral_code: "TOLA10",
    };
    expect(params).toMatchObject({
      mode: "subscription",
      line_items: [
        {
          quantity: 1,
          price_data: { currency: "usd", unit_amount: 800, recurring: { interval: "month" } },
        },
      ],
      subscription_data: { metadata, trial_period_days: TRIAL_DAYS },
      metadata,
      customer_email: "s@example.com",
    });
  });

  it("leaves the trial out when the student has had one", async () => {
    const { api, typed } = fakeApi();
    await createStripeProvider({ api: typed, store, webhookSecret: "w" }).createCheckout(
      checkout({ trial: false }),
    );
    const params = api.checkout.sessions.create.mock
      .calls[0]![0] as Stripe.Checkout.SessionCreateParams;
    expect(params.subscription_data).not.toHaveProperty("trial_period_days");
  });

  it("sells bulk seats by quantity to groups only", async () => {
    const { api, typed } = fakeApi();
    const provider = createStripeProvider({ api: typed, store, webhookSecret: "w" });
    await provider.createCheckout(
      checkout({
        target: { kind: "group", groupAccountId: STUDENT, seats: 25 },
        planId: "bulk_seat_monthly",
        currency: "GBP",
      }),
    );
    expect(api.checkout.sessions.create.mock.calls[0]![0]).toMatchObject({
      line_items: [{ quantity: 25, price_data: { unit_amount: 400 } }],
      metadata: { group_account_id: STUDENT, plan: "bulk_seat_monthly" },
    });
    await expect(
      provider.createCheckout(checkout({ planId: "bulk_seat_monthly", currency: "GBP" })),
    ).rejects.toThrow(/group/);
  });

  it("refuses naira plans and currencies a plan isn't sold in", async () => {
    const provider = createStripeProvider({ api: fakeApi().typed, store, webhookSecret: "w" });
    await expect(
      provider.createCheckout(checkout({ planId: "nigeria_weekly", currency: "NGN" })),
    ).rejects.toThrow(/Paystack/);
    await expect(provider.createCheckout(checkout({ currency: "NGN" }))).rejects.toThrow(
      /not sold/,
    );
  });
});

describe("Stripe cancel and manage link", () => {
  const record: SubscriptionRecord = {
    id: "x",
    provider: "stripe",
    providerSubscriptionId: "sub_1",
    providerCustomerId: "cus_1",
    providerMeta: {},
    status: "active",
    currentPeriodEnd: null,
  };

  it("cancels at the end of the paid period", async () => {
    const { api, typed } = fakeApi();
    await createStripeProvider({ api: typed, store, webhookSecret: "w" }).cancel(record);
    expect(api.subscriptions.update).toHaveBeenCalledWith("sub_1", { cancel_at_period_end: true });
    expect(api.subscriptions.cancel).not.toHaveBeenCalled();
  });

  it("cancels at once when a child's data is being deleted", async () => {
    const { api, typed } = fakeApi();
    await createStripeProvider({ api: typed, store, webhookSecret: "w" }).cancel(record, {
      immediately: true,
    });
    expect(api.subscriptions.cancel).toHaveBeenCalledWith("sub_1");
  });

  it("opens the customer portal for card changes and cancellation", async () => {
    const { api, typed } = fakeApi();
    const provider = createStripeProvider({ api: typed, store, webhookSecret: "w" });
    expect(await provider.getManageLink(record, "https://kinprep.test/app")).toBe(
      "https://billing.stripe.test/p",
    );
    expect(api.billingPortal.sessions.create).toHaveBeenCalledWith({
      customer: "cus_1",
      return_url: "https://kinprep.test/app",
    });
    expect(await provider.getManageLink({ ...record, providerCustomerId: null }, "x")).toBeNull();
  });
});

describe("stripeEventToUpdate", () => {
  const sub = (metadata: Record<string, string>, status = "active") =>
    ({
      id: "sub_1",
      status,
      customer: { id: "cus_1" },
      currency: "gbp",
      metadata,
      items: { data: [{ current_period_end: 1_800_000_000, quantity: 3 }] },
      trial_end: null,
      cancel_at_period_end: true,
      canceled_at: 1_790_000_000,
      ended_at: 1_795_000_000,
    }) as unknown as Stripe.Subscription;

  const event = (type: string, object: unknown) =>
    ({ id: "evt_1", type, created: 1_790_000_000, data: { object } }) as unknown as Stripe.Event;

  const api = { subscriptions: { retrieve: vi.fn() } } as unknown as Pick<
    StripeApi,
    "subscriptions"
  >;

  it("ignores subscriptions KinPrep didn't create", async () => {
    expect(
      await stripeEventToUpdate(event("customer.subscription.updated", sub({})), api),
    ).toBeNull();
  });

  it("ends access when the subscription actually ended", async () => {
    const update = await stripeEventToUpdate(
      event(
        "customer.subscription.deleted",
        sub({ plan: "abroad_monthly", student_id: STUDENT }, "canceled"),
      ),
      api,
    );
    expect(update?.subscription).toMatchObject({
      status: "canceled",
      current_period_end: new Date(1_795_000_000_000).toISOString(),
    });
  });

  it("carries group seats from the subscription quantity", async () => {
    const update = await stripeEventToUpdate(
      event(
        "customer.subscription.updated",
        sub({ plan: "bulk_seat_monthly", group_account_id: STUDENT }),
      ),
      api,
    );
    expect(update?.subscription).toMatchObject({
      group_account_id: STUDENT,
      seats: 3,
      grace_until: null,
    });
  });

  it("ignores one-off checkouts and invoices outside subscriptions", async () => {
    expect(
      await stripeEventToUpdate(event("checkout.session.completed", { mode: "payment" }), api),
    ).toBeNull();
    expect(
      await stripeEventToUpdate(event("invoice.paid", { parent: null, lines: { data: [] } }), api),
    ).toBeNull();
  });

  it("maps every Stripe status to one of ours", () => {
    expect(mapStripeStatus("unpaid")).toBe("past_due");
    expect(mapStripeStatus("incomplete_expired")).toBe("canceled");
    expect(mapStripeStatus("paused")).toBe("incomplete");
    expect(mapStripeStatus("incomplete")).toBe("incomplete");
  });
});
