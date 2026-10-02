import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createPaystackProvider, paystackEventToUpdate, verifyPaystackSignature } from "./paystack";
import type { BillingStore, CheckoutInput, SubscriptionRecord } from "./types";

const SECRET = "sk_test_abc";
const STUDENT = "6f1d6c2e-8a51-4f0e-9d3a-2b7c1e4f5a60";
const PLAN_CODES = { nigeria_weekly: "PLN_week", nigeria_monthly: "PLN_month" };

function fakeFetch(json: unknown, ok = true) {
  return vi.fn(async () => ({ ok, status: ok ? 200 : 400, json: async () => json }) as Response);
}

const checkout = (overrides: Partial<CheckoutInput> = {}): CheckoutInput => ({
  target: { kind: "student", studentId: STUDENT },
  planId: "nigeria_weekly",
  currency: "NGN",
  payerEmail: "parent@example.com",
  trial: false,
  successUrl: "https://kinprep.test/done",
  cancelUrl: "https://kinprep.test/back",
  ...overrides,
});

const initialized = {
  status: true,
  data: { authorization_url: "https://checkout.paystack.test/abc", reference: "kp_1" },
};

describe("verifyPaystackSignature", () => {
  const body = '{"event":"charge.success"}';
  const good = createHmac("sha512", SECRET).update(body).digest("hex");

  it("accepts the HMAC-SHA512 of the raw body", () => {
    expect(verifyPaystackSignature(body, good, SECRET)).toBe(true);
  });

  it("rejects a missing, wrong, short or tampered signature", () => {
    expect(verifyPaystackSignature(body, null, SECRET)).toBe(false);
    expect(verifyPaystackSignature(body, good.replace(/^./, "0"), SECRET)).toBe(false);
    expect(verifyPaystackSignature(body, "abcd", SECRET)).toBe(false);
    expect(verifyPaystackSignature(body + " ", good, SECRET)).toBe(false);
  });
});

describe("Paystack createCheckout", () => {
  it("starts a recurring card subscription on the plan", async () => {
    const fetch = fakeFetch(initialized);
    const provider = createPaystackProvider({
      secretKey: SECRET,
      planCodes: PLAN_CODES,
      store: {} as BillingStore,
      fetch,
    });
    expect(await provider.createCheckout(checkout())).toEqual({
      kind: "redirect",
      url: "https://checkout.paystack.test/abc",
      reference: "kp_1",
    });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.paystack.co/transaction/initialize");
    expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${SECRET}`);
    expect(JSON.parse(init.body as string)).toMatchObject({
      email: "parent@example.com",
      amount: 50_000,
      currency: "NGN",
      plan: "PLN_week",
      channels: ["card"],
      metadata: { kind: "subscription", plan: "nigeria_weekly", student_id: STUDENT },
    });
  });

  it("offers bank transfer and USSD as pay-per-period, without a plan", async () => {
    const fetch = fakeFetch(initialized);
    const provider = createPaystackProvider({
      secretKey: SECRET,
      planCodes: PLAN_CODES,
      store: {} as BillingStore,
      fetch,
    });
    await provider.createCheckout(
      checkout({ planId: "nigeria_monthly", channel: "bank_transfer_or_ussd" }),
    );
    const body = JSON.parse(
      (fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
    );
    expect(body).toMatchObject({
      amount: 200_000,
      channels: ["bank_transfer", "ussd"],
      metadata: { kind: "period" },
    });
    expect(body).not.toHaveProperty("plan");
  });

  it("refuses foreign-currency plans, groups and a missing email or plan code", async () => {
    const provider = createPaystackProvider({
      secretKey: SECRET,
      planCodes: {},
      store: {} as BillingStore,
      fetch: fakeFetch(initialized),
    });
    await expect(
      provider.createCheckout(checkout({ planId: "abroad_monthly", currency: "GBP" })),
    ).rejects.toThrow(/naira/);
    await expect(
      provider.createCheckout(
        checkout({ target: { kind: "group", groupAccountId: STUDENT, seats: 2 } }),
      ),
    ).rejects.toThrow(/Stripe/);
    await expect(provider.createCheckout(checkout({ payerEmail: undefined }))).rejects.toThrow(
      /email/,
    );
    await expect(provider.createCheckout(checkout())).rejects.toThrow(/plan code/);
  });

  it("surfaces Paystack's error message", async () => {
    const provider = createPaystackProvider({
      secretKey: SECRET,
      planCodes: PLAN_CODES,
      store: {} as BillingStore,
      fetch: fakeFetch({ status: false, message: "Invalid key" }, false),
    });
    await expect(provider.createCheckout(checkout())).rejects.toThrow(/Invalid key/);
  });
});

describe("Paystack cancel and manage link", () => {
  const record = (overrides: Partial<SubscriptionRecord> = {}): SubscriptionRecord => ({
    id: "x",
    provider: "paystack",
    providerSubscriptionId: "SUB_1",
    providerCustomerId: "CUS_1",
    providerMeta: { email_token: "tok" },
    status: "active",
    currentPeriodEnd: null,
    ...overrides,
  });

  it("disables the subscription with its email token", async () => {
    const fetch = fakeFetch({ status: true, message: "ok" });
    await createPaystackProvider({
      secretKey: SECRET,
      planCodes: {},
      store: {} as BillingStore,
      fetch,
    }).cancel(record());
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.paystack.co/subscription/disable");
    expect(JSON.parse(init.body as string)).toEqual({ code: "SUB_1", token: "tok" });
  });

  it("has nothing to cancel for pay-per-period, and waits for Paystack's confirmation", async () => {
    const fetch = fakeFetch({});
    const provider = createPaystackProvider({
      secretKey: SECRET,
      planCodes: {},
      store: {} as BillingStore,
      fetch,
    });
    await provider.cancel(record({ providerSubscriptionId: null }));
    expect(fetch).not.toHaveBeenCalled();
    await expect(
      provider.cancel(record({ providerSubscriptionId: "pending:kp_1" })),
    ).rejects.toThrow(/not confirmed/);
  });

  it("returns Paystack's manage link", async () => {
    const fetch = fakeFetch({ status: true, data: { link: "https://paystack.test/manage/x" } });
    const provider = createPaystackProvider({
      secretKey: SECRET,
      planCodes: {},
      store: {} as BillingStore,
      fetch,
    });
    expect(await provider.getManageLink(record(), "x")).toBe("https://paystack.test/manage/x");
    expect(await provider.getManageLink(record({ providerSubscriptionId: null }), "x")).toBeNull();
  });
});

describe("paystackEventToUpdate", () => {
  const now = new Date("2026-10-01T00:00:00Z");
  const map = (body: unknown) => paystackEventToUpdate(body, JSON.stringify(body), PLAN_CODES, now);

  it("marks the first card charge as a pending subscription for the student", () => {
    const update = map({
      event: "charge.success",
      data: {
        id: 1,
        reference: "kp_1",
        amount: 50_000,
        currency: "NGN",
        paid_at: "2026-10-01T09:00:00Z",
        channel: "card",
        metadata: JSON.stringify({
          kind: "subscription",
          plan: "nigeria_weekly",
          student_id: STUDENT,
        }),
        customer: { customer_code: "CUS_1" },
        plan: { plan_code: "PLN_week" },
      },
    });
    expect(update?.subscription).toMatchObject({
      provider_subscription_id: "pending:kp_1",
      student_id: STUDENT,
      extend: { by: "7 days" },
    });
  });

  it("matches a renewal Paystack charged by itself by customer and plan", () => {
    const update = map({
      event: "charge.success",
      data: {
        id: 2,
        reference: "auto",
        amount: 200_000,
        currency: "NGN",
        customer: { customer_code: "CUS_1" },
        plan: { plan_code: "PLN_month" },
      },
    });
    expect(update?.subscription).toEqual({
      match_customer: { customer_id: "CUS_1", plan: "nigeria_monthly" },
      extend: { from: now.toISOString(), by: "1 month" },
    });
  });

  it("starts grace when an invoice payment fails", () => {
    const update = map({
      event: "invoice.payment_failed",
      data: {
        invoice_code: "INV_1",
        amount: 50_000,
        updatedAt: "2026-10-08T09:00:00Z",
        subscription: { subscription_code: "SUB_1" },
      },
    });
    expect(update).toMatchObject({
      event_id: "invoice.payment_failed:INV_1",
      subscription: { status: "past_due", grace_until: "2026-10-11T09:00:00.000Z" },
      payment: { status: "failed", amount_minor: 50_000 },
    });
  });

  it("cancels on subscription.disable and ignores charges and plans that aren't ours", () => {
    const disable = map({
      event: "subscription.disable",
      data: {
        subscription_code: "SUB_1",
        plan: { plan_code: "PLN_week" },
        customer: { customer_code: "CUS_1" },
      },
    });
    expect(disable?.subscription).toMatchObject({
      status: "canceled",
      provider_subscription_id: "SUB_1",
    });
    expect(
      map({
        event: "charge.success",
        data: {
          id: 3,
          reference: "r",
          amount: 1,
          currency: "NGN",
          customer: { customer_code: "C" },
          plan: {},
        },
      }),
    ).toBeNull();
    expect(
      map({
        event: "subscription.create",
        data: {
          subscription_code: "S",
          plan: { plan_code: "PLN_other" },
          customer: { customer_code: "C" },
        },
      }),
    ).toBeNull();
    expect(map({ event: "transfer.success", data: {} })).toBeNull();
    expect(map("not an event")).toBeNull();
  });
});
