import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import type { BillingUpdate } from "@/lib/payments/types";
import { createGroup, createStudent, createTestDb, createUser } from "./harness";
import { createPgBillingStore } from "./pg-store";

let db: PGlite;
let store: ReturnType<typeof createPgBillingStore>;
let owner: string;

beforeAll(async () => {
  db = await createTestDb();
  store = createPgBillingStore(db);
  owner = await createUser(db);
});

const at = (iso: string) => new Date(iso).toISOString();

function stripeUpdate(
  overrides: Partial<BillingUpdate> & Pick<BillingUpdate, "subscription">,
): BillingUpdate {
  return {
    provider: "stripe",
    event_id: `evt_${randomUUID()}`,
    event_type: "customer.subscription.updated",
    occurred_at: at("2026-10-01T10:00:00Z"),
    ...overrides,
  };
}

async function subscriptionFor(studentId: string) {
  const { rows } = await db.query<Record<string, unknown>>(
    "select * from public.subscriptions where student_id = $1",
    [studentId],
  );
  return rows;
}

async function snapshot() {
  const tables = ["subscriptions", "payments", "billing_events", "audit_log"];
  const result: Record<string, unknown[]> = {};
  for (const table of tables) {
    result[table] = (await db.query(`select * from public.${table} order by 1`)).rows;
  }
  return result;
}

describe("apply_billing_event", () => {
  it("creates the subscription on the first event and ignores a replay completely", async () => {
    const student = await createStudent(db, owner);
    const update = stripeUpdate({
      subscription: {
        provider_subscription_id: `sub_${randomUUID()}`,
        student_id: student,
        plan: "abroad_monthly",
        currency: "GBP",
        status: "active",
        current_period_end: at("2026-11-01T10:00:00Z"),
      },
      payment: {
        provider_payment_id: `in_${randomUUID()}`,
        status: "succeeded",
        amount_minor: 600,
        currency: "GBP",
      },
    });
    expect(await store.applyBillingEvent(update)).toBe("applied");
    const before = await snapshot();

    expect(await store.applyBillingEvent(update)).toBe("duplicate");
    expect(await snapshot()).toEqual(before);
    expect(await subscriptionFor(student)).toMatchObject([{ status: "active" }]);
  });

  it("never lets an older event overwrite newer state", async () => {
    const student = await createStudent(db, owner);
    const id = `sub_${randomUUID()}`;
    const base = {
      provider_subscription_id: id,
      student_id: student,
      plan: "abroad_monthly",
      currency: "GBP",
    } as const;
    await store.applyBillingEvent(
      stripeUpdate({
        occurred_at: at("2026-10-05T00:00:00Z"),
        subscription: { ...base, status: "canceled" },
      }),
    );
    await store.applyBillingEvent(
      stripeUpdate({
        occurred_at: at("2026-10-01T00:00:00Z"),
        subscription: { ...base, status: "active" },
      }),
    );
    expect(await subscriptionFor(student)).toMatchObject([{ status: "canceled" }]);
  });

  it("keeps the first grace deadline when payments keep failing", async () => {
    const student = await createStudent(db, owner);
    const id = `sub_${randomUUID()}`;
    const fail = (day: string) =>
      store.applyBillingEvent(
        stripeUpdate({
          occurred_at: at(`2026-10-${day}T00:00:00Z`),
          subscription: {
            provider_subscription_id: id,
            student_id: student,
            plan: "abroad_monthly",
            currency: "GBP",
            status: "past_due",
            grace_until: at(`2026-10-${String(Number(day) + 3).padStart(2, "0")}T00:00:00Z`),
          },
        }),
      );
    await fail("01");
    await fail("02");
    const [row] = await subscriptionFor(student);
    expect(row!.grace_until).toEqual(new Date("2026-10-04T00:00:00Z"));
  });

  it("clears grace once a payment succeeds", async () => {
    const student = await createStudent(db, owner);
    const sub = {
      provider_subscription_id: `sub_${randomUUID()}`,
      student_id: student,
      plan: "abroad_monthly",
      currency: "GBP",
    } as const;
    await store.applyBillingEvent(
      stripeUpdate({
        occurred_at: at("2026-10-01T00:00:00Z"),
        subscription: { ...sub, status: "past_due", grace_until: at("2026-10-04T00:00:00Z") },
      }),
    );
    await store.applyBillingEvent(
      stripeUpdate({
        occurred_at: at("2026-10-02T00:00:00Z"),
        subscription: { ...sub, status: "active", grace_until: null },
      }),
    );
    expect(await subscriptionFor(student)).toMatchObject([{ status: "active", grace_until: null }]);
  });

  it("rolls back an event for an unknown subscription, so the provider's retry can succeed", async () => {
    const update = stripeUpdate({
      subscription: { provider_subscription_id: `sub_${randomUUID()}`, status: "active" },
    });
    await expect(store.applyBillingEvent(update)).rejects.toThrow(/unknown subscription/);
    const { rows } = await db.query("select 1 from public.billing_events where event_id = $1", [
      update.event_id,
    ]);
    expect(rows).toEqual([]);
  });
});

describe("pay-per-period coverage", () => {
  const charge = (
    student: string,
    paidAt: string,
    paymentId: string = randomUUID(),
  ): BillingUpdate => ({
    provider: "paystack",
    event_id: `charge.success:${paymentId}`,
    event_type: "charge.success",
    occurred_at: at(paidAt),
    subscription: {
      student_id: student,
      plan: "nigeria_weekly",
      currency: "NGN",
      extend: { from: at(paidAt), by: "7 days" },
    },
    payment: {
      provider_payment_id: paymentId,
      status: "succeeded",
      amount_minor: 50_000,
      currency: "NGN",
    },
  });

  it("adds a week from the payment, then a week on top of the remaining time", async () => {
    const student = await createStudent(db, owner);
    await store.applyBillingEvent(charge(student, "2026-10-01T09:00:00Z"));
    await store.applyBillingEvent(charge(student, "2026-10-06T09:00:00Z"));
    const rows = await subscriptionFor(student);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: "active",
      current_period_end: new Date("2026-10-15T09:00:00Z"),
    });
  });

  it("starts from the payment date after the cover has lapsed", async () => {
    const student = await createStudent(db, owner);
    await store.applyBillingEvent(charge(student, "2026-10-01T09:00:00Z"));
    await store.applyBillingEvent(charge(student, "2026-10-20T09:00:00Z"));
    expect((await subscriptionFor(student))[0]).toMatchObject({
      current_period_end: new Date("2026-10-27T09:00:00Z"),
    });
  });

  it("never extends twice for the same payment, even under a different event id", async () => {
    const student = await createStudent(db, owner);
    const first = charge(student, "2026-10-01T09:00:00Z", "pay-1");
    await store.applyBillingEvent(first);
    await store.applyBillingEvent({ ...first, event_id: "charge.success:other-id" });
    expect((await subscriptionFor(student))[0]).toMatchObject({
      current_period_end: new Date("2026-10-08T09:00:00Z"),
    });
    const { rows } = await db.query(
      "select 1 from public.payments where provider_payment_id = 'pay-1'",
    );
    expect(rows).toHaveLength(1);
  });

  it("records a manual payment's exact period, with an audit entry, without shortening cover", async () => {
    const student = await createStudent(db, owner);
    const admin = await createUser(db, "admin");
    const manual = (ref: string, from: string, until: string): BillingUpdate => ({
      provider: "manual",
      event_id: `manual:${ref}`,
      event_type: "manual.payment_recorded",
      occurred_at: at("2026-10-01T12:00:00Z"),
      subscription: {
        student_id: student,
        plan: "nigeria_monthly",
        currency: "NGN",
        extend: { from: at(from), until: at(until) },
      },
      payment: {
        provider_payment_id: ref,
        status: "succeeded",
        amount_minor: 200_000,
        currency: "NGN",
        recorded_by: admin,
      },
      audit: { actor_id: admin, action: "payment.manual_recorded" },
    });
    await store.applyBillingEvent(manual("BANK-1", "2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z"));
    // A shorter, overlapping period recorded later must not cut the cover short.
    await store.applyBillingEvent(manual("BANK-2", "2026-10-01T00:00:00Z", "2026-10-15T00:00:00Z"));
    expect((await subscriptionFor(student))[0]).toMatchObject({
      provider: "manual",
      status: "active",
      current_period_end: new Date("2026-11-01T00:00:00Z"),
    });
    const audit = await db.query("select * from public.audit_log where actor_id = $1", [admin]);
    expect(audit.rows).toHaveLength(2);
    const payment = await db.query<{ period_start: Date; period_end: Date }>(
      "select period_start, period_end from public.payments where provider_payment_id = 'BANK-2'",
    );
    expect(payment.rows[0]).toEqual({
      period_start: new Date("2026-10-01T00:00:00Z"),
      period_end: new Date("2026-10-15T00:00:00Z"),
    });
  });
});

describe("Paystack subscription linking", () => {
  it("links subscription.create to the pending row, then renewals by customer and plan", async () => {
    const student = await createStudent(db, owner);
    const customer = `CUS_${randomUUID()}`;
    // First charge from our checkout.
    await store.applyBillingEvent({
      provider: "paystack",
      event_id: "charge.success:first",
      event_type: "charge.success",
      occurred_at: at("2026-10-01T08:00:00Z"),
      subscription: {
        provider_subscription_id: "pending:kp_ref1",
        student_id: student,
        plan: "nigeria_monthly",
        currency: "NGN",
        provider_customer_id: customer,
        extend: { from: at("2026-10-01T08:00:00Z"), by: "1 month" },
      },
      payment: {
        provider_payment_id: "first",
        status: "succeeded",
        amount_minor: 200_000,
        currency: "NGN",
      },
    });
    // Paystack confirms the subscription.
    await store.applyBillingEvent({
      provider: "paystack",
      event_id: "subscription.create:SUB_abc",
      event_type: "subscription.create",
      occurred_at: at("2026-10-01T08:00:05Z"),
      subscription: {
        provider_subscription_id: "SUB_abc",
        match_customer: { customer_id: customer, plan: "nigeria_monthly", pending_only: true },
        status: "active",
        current_period_end: at("2026-11-01T08:00:00Z"),
        provider_meta: { email_token: "tok" },
      },
    });
    // Paystack renews by itself a month later.
    await store.applyBillingEvent({
      provider: "paystack",
      event_id: "charge.success:renewal",
      event_type: "charge.success",
      occurred_at: at("2026-11-01T08:00:00Z"),
      subscription: {
        match_customer: { customer_id: customer, plan: "nigeria_monthly" },
        extend: { from: at("2026-11-01T08:00:00Z"), by: "1 month" },
      },
      payment: {
        provider_payment_id: "renewal",
        status: "succeeded",
        amount_minor: 200_000,
        currency: "NGN",
      },
    });
    const rows = await subscriptionFor(student);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      provider_subscription_id: "SUB_abc",
      provider_meta: { email_token: "tok" },
      current_period_end: new Date("2026-12-01T08:00:00Z"),
    });
  });
});

describe("student_coverages", () => {
  it("includes group seats only while the seat is assigned", async () => {
    const buyer = await createUser(db, "group_buyer");
    const group = await createGroup(db, buyer);
    const student = await createStudent(db, buyer);
    await store.applyBillingEvent({
      provider: "stripe",
      event_id: `evt_${randomUUID()}`,
      event_type: "customer.subscription.updated",
      occurred_at: at("2026-10-01T00:00:00Z"),
      subscription: {
        provider_subscription_id: `sub_${randomUUID()}`,
        group_account_id: group,
        seats: 5,
        plan: "bulk_seat_monthly",
        currency: "GBP",
        status: "active",
        current_period_end: at("2026-11-01T00:00:00Z"),
      },
    });
    await db.query(
      `insert into public.seat_assignments (subscription_id, student_id, assigned_at, released_at)
       select id, $2, '2026-10-02T00:00:00Z', '2026-10-10T00:00:00Z'
       from public.subscriptions where group_account_id = $1`,
      [group, student],
    );
    expect(await store.getCoverages(student, new Date("2026-10-05T00:00:00Z"))).toHaveLength(1);
    expect(await store.getCoverages(student, new Date("2026-10-01T00:00:00Z"))).toHaveLength(0);
    expect(await store.getCoverages(student, new Date("2026-10-11T00:00:00Z"))).toHaveLength(0);
  });
});
