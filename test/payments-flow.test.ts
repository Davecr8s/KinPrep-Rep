import { createHmac, randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import Stripe from "stripe";
import { beforeAll, describe, expect, it } from "vitest";
import { GRACE_DAYS, TRIAL_DAYS } from "@/config/pricing";
import { getStudentAccess, isStudentActive } from "@/lib/access";
import { recordManualPayment } from "@/lib/payments/manual";
import { createPaystackProvider } from "@/lib/payments/paystack";
import { createStripeProvider, type StripeApi } from "@/lib/payments/stripe";
import { WebhookSignatureError, type PaymentProvider } from "@/lib/payments/types";
import { createStudent, createTestDb, createUser } from "./db/harness";
import { createPgBillingStore } from "./db/pg-store";

// The payments "Done when" checks, end to end without network: signed webhooks go through the
// real provider code and SQL, and isStudentActive reads the result.

const WEBHOOK_SECRET = "whsec_kinprep_test";
const PAYSTACK_SECRET = "sk_test_kinprep_paystack";
const stripeSdk = new Stripe("sk_test_kinprep_dummy");

const DAY = 24 * 60 * 60;
const T0 = Date.parse("2026-10-01T10:00:00Z") / 1000;
const dateAt = (unix: number) => new Date(unix * 1000);

let db: PGlite;
let store: ReturnType<typeof createPgBillingStore>;
let owner: string;

beforeAll(async () => {
  db = await createTestDb();
  store = createPgBillingStore(db);
  owner = await createUser(db);
});

async function snapshot() {
  const result: Record<string, unknown[]> = {};
  for (const table of ["subscriptions", "payments", "billing_events"]) {
    result[table] = (await db.query(`select * from public.${table} order by 1`)).rows;
  }
  return result;
}

describe("Stripe: checkout, renewal failure, grace, replay", () => {
  let studentId: string;
  let provider: PaymentProvider;
  const subscriptionId = `sub_${randomUUID()}`;
  const trialEnd = T0 + TRIAL_DAYS * DAY;
  const firstPeriodEnd = trialEnd + 30 * DAY;
  let current: Record<string, unknown>;

  const metadata = () => ({ plan: "abroad_monthly", student_id: studentId });

  function subscription(status: string, periodEnd: number) {
    return {
      id: subscriptionId,
      object: "subscription",
      status,
      customer: "cus_test",
      currency: "gbp",
      metadata: metadata(),
      items: { object: "list", data: [{ current_period_end: periodEnd, quantity: 1 }] },
      trial_end: trialEnd,
      cancel_at_period_end: false,
      canceled_at: null,
      ended_at: null,
    };
  }

  function invoice(amount: number, periodStart: number, periodEnd: number) {
    return {
      id: `in_${randomUUID()}`,
      object: "invoice",
      amount_paid: amount,
      amount_due: amount,
      attempt_count: 1,
      currency: "gbp",
      customer: "cus_test",
      parent: {
        type: "subscription_details",
        subscription_details: { subscription: subscriptionId, metadata: metadata() },
      },
      lines: {
        object: "list",
        data: [{ period: { start: periodStart, end: periodEnd }, quantity: 1 }],
      },
    };
  }

  function stripeEvent(type: string, object: unknown, created: number) {
    return { id: `evt_${randomUUID()}`, object: "event", type, created, data: { object } };
  }

  async function deliver(event: unknown, signature?: string) {
    const payload = JSON.stringify(event);
    const header =
      signature ??
      (await stripeSdk.webhooks.generateTestHeaderStringAsync({ payload, secret: WEBHOOK_SECRET }));
    return provider.handleWebhook({
      rawBody: payload,
      headers: new Headers({ "stripe-signature": header }),
    });
  }

  beforeAll(async () => {
    studentId = await createStudent(db, owner);
    current = subscription("trialing", trialEnd);
    const api = {
      webhooks: stripeSdk.webhooks,
      subscriptions: {
        retrieve: async () => current,
        update: async () => current,
      },
    } as unknown as StripeApi;
    provider = createStripeProvider({ api, store, webhookSecret: WEBHOOK_SECRET });
  });

  it("is inactive before checkout", async () => {
    expect(await isStudentActive(studentId, { store, now: dateAt(T0) })).toBe(false);
  });

  it("activates the student when the test checkout completes (trial)", async () => {
    const session = {
      id: "cs_test",
      object: "checkout.session",
      mode: "subscription",
      subscription: subscriptionId,
      customer_details: { email: "sponsor@example.com" },
    };
    expect(await deliver(stripeEvent("checkout.session.completed", session, T0))).toMatchObject({
      status: "applied",
    });
    expect(await getStudentAccess(studentId, { store, now: dateAt(T0 + DAY) })).toEqual({
      state: "active",
      until: dateAt(trialEnd),
    });
    const { rows } = await db.query(
      "select payer_email from public.subscriptions where student_id = $1",
      [studentId],
    );
    expect(rows).toEqual([{ payer_email: "sponsor@example.com" }]);
  });

  it("stays active after the first real payment", async () => {
    current = subscription("active", firstPeriodEnd);
    await deliver(stripeEvent("invoice.paid", invoice(600, trialEnd, firstPeriodEnd), trialEnd));
    await deliver(stripeEvent("customer.subscription.updated", current, trialEnd + 1));
    expect(await getStudentAccess(studentId, { store, now: dateAt(trialEnd + 10 * DAY) })).toEqual({
      state: "active",
      until: dateAt(firstPeriodEnd),
    });
    const { rows } = await db.query("select amount_minor, status from public.payments");
    expect(rows).toContainEqual({ amount_minor: 600, status: "succeeded" });
  });

  let failedEvent: unknown;
  const failedAt = firstPeriodEnd + 3600;

  it("moves to grace when the renewal fails, then inactive after the grace period", async () => {
    failedEvent = stripeEvent(
      "invoice.payment_failed",
      invoice(600, firstPeriodEnd, firstPeriodEnd + 30 * DAY),
      failedAt,
    );
    await deliver(failedEvent);
    // Stripe also moves the subscription itself to past_due, with the new (unpaid) period.
    await deliver(
      stripeEvent(
        "customer.subscription.updated",
        subscription("past_due", firstPeriodEnd + 30 * DAY),
        failedAt + 1,
      ),
    );

    const graceEnd = failedAt + GRACE_DAYS * DAY;
    expect(await getStudentAccess(studentId, { store, now: dateAt(failedAt + DAY) })).toEqual({
      state: "grace",
      until: dateAt(graceEnd),
    });
    expect(await isStudentActive(studentId, { store, now: dateAt(graceEnd - 60) })).toBe(true);
    expect(await isStudentActive(studentId, { store, now: dateAt(graceEnd + 60) })).toBe(false);
  });

  it("changes nothing when the same webhook is replayed", async () => {
    const before = await snapshot();
    expect(await deliver(failedEvent)).toMatchObject({ status: "duplicate" });
    expect(await snapshot()).toEqual(before);
  });

  it("rejects a webhook with a bad or missing signature, and records nothing", async () => {
    const before = await snapshot();
    const forged = stripeEvent(
      "invoice.paid",
      invoice(600, failedAt, failedAt + 30 * DAY),
      failedAt + DAY,
    );
    await expect(deliver(forged, "t=1,v1=deadbeef")).rejects.toBeInstanceOf(WebhookSignatureError);
    await expect(
      provider.handleWebhook({ rawBody: JSON.stringify(forged), headers: new Headers() }),
    ).rejects.toBeInstanceOf(WebhookSignatureError);
    expect(await snapshot()).toEqual(before);
  });

  it("ignores event types KinPrep doesn't act on", async () => {
    expect(await deliver(stripeEvent("customer.created", { id: "cus_x" }, failedAt))).toMatchObject(
      {
        status: "ignored",
      },
    );
  });
});

describe("Paystack: transfer payment buys one period", () => {
  it("activates for a week, then grace, then inactive; a replay changes nothing", async () => {
    const studentId = await createStudent(db, owner);
    const provider = createPaystackProvider({ secretKey: PAYSTACK_SECRET, planCodes: {}, store });
    const paidAt = "2026-10-01T09:00:00.000Z";
    const body = JSON.stringify({
      event: "charge.success",
      data: {
        id: 4_242_424,
        reference: "kp_ref",
        amount: 50_000,
        currency: "NGN",
        paid_at: paidAt,
        channel: "bank_transfer",
        metadata: { kind: "period", plan: "nigeria_weekly", student_id: studentId },
        customer: { customer_code: "CUS_parent", email: "parent@example.com" },
        plan: {},
      },
    });
    const signature = createHmac("sha512", PAYSTACK_SECRET).update(body).digest("hex");
    const deliver = (sig: string) =>
      provider.handleWebhook({
        rawBody: body,
        headers: new Headers({ "x-paystack-signature": sig }),
      });

    expect(await deliver(signature)).toMatchObject({ status: "applied" });
    const weekLater = new Date(Date.parse(paidAt) + 7 * DAY * 1000);
    expect(
      await getStudentAccess(studentId, { store, now: new Date("2026-10-05T00:00:00Z") }),
    ).toEqual({
      state: "active",
      until: weekLater,
    });
    expect(
      (await getStudentAccess(studentId, { store, now: new Date(weekLater.getTime() + 1000) }))
        .state,
    ).toBe("grace");
    expect(
      await isStudentActive(studentId, {
        store,
        now: new Date(weekLater.getTime() + GRACE_DAYS * DAY * 1000 + 1000),
      }),
    ).toBe(false);

    const before = await snapshot();
    expect(await deliver(signature)).toMatchObject({ status: "duplicate" });
    expect(await snapshot()).toEqual(before);
    await expect(deliver("00".repeat(64))).rejects.toBeInstanceOf(WebhookSignatureError);
  });
});

describe("Manual: admin records a bank transfer", () => {
  it("covers exactly the recorded period, once", async () => {
    const studentId = await createStudent(db, owner);
    const admin = await createUser(db, "admin");
    const payment = {
      target: { kind: "student" as const, studentId },
      planId: "nigeria_monthly" as const,
      currency: "NGN" as const,
      amountMinor: 200_000,
      paidAt: "2026-10-01T08:00:00Z",
      periodStart: "2026-10-01T00:00:00Z",
      periodEnd: "2026-11-01T00:00:00Z",
      bankReference: "GTB-778812",
    };
    expect(await recordManualPayment(store, payment, admin)).toBe("applied");
    expect(await recordManualPayment(store, payment, admin)).toBe("duplicate");
    expect(
      await getStudentAccess(studentId, { store, now: new Date("2026-10-20T00:00:00Z") }),
    ).toEqual({
      state: "active",
      until: new Date("2026-11-01T00:00:00Z"),
    });
  });
});

describe("sponsor links and referral codes", () => {
  it("reveals only first name, class and exam, and only for live links", async () => {
    const studentId = await createStudent(db, owner, { firstName: "Chidi" });
    const code = "abcdefghijklmnopqrstuv";
    await db.query("insert into public.sponsor_links (code, student_id) values ($1, $2)", [
      code,
      studentId,
    ]);
    expect(await store.findSponsorLink(code)).toEqual({
      studentId,
      firstName: "Chidi",
      className: "SS2",
      exam: "WASSCE",
    });
    await db.query("update public.sponsor_links set revoked_at = now() where code = $1", [code]);
    expect(await store.findSponsorLink(code)).toBeNull();
  });

  it("finds active ambassadors only", async () => {
    await db.query(
      "insert into public.ambassadors (name, code) values ('Tola', 'TOLA10'), ('Old', 'OLD10')",
    );
    await db.query("update public.ambassadors set active = false where code = 'OLD10'");
    expect(await store.findActiveAmbassador("TOLA10")).toMatchObject({ code: "TOLA10" });
    expect(await store.findActiveAmbassador("OLD10")).toBeNull();
  });
});
