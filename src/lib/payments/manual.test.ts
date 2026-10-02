import { describe, expect, it, vi } from "vitest";
import { isSponsorCodeShape, newSponsorCode, normalizeReferralCode } from "./codes";
import {
  createManualProvider,
  manualPaymentToUpdate,
  newTransferReference,
  type ManualPayment,
} from "./manual";
import type { BillingStore } from "./types";

const STUDENT = "6f1d6c2e-8a51-4f0e-9d3a-2b7c1e4f5a60";
const ADMIN = "0b9a8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d";

const payment = (overrides: Partial<ManualPayment> = {}): ManualPayment => ({
  target: { kind: "student", studentId: STUDENT },
  planId: "nigeria_monthly",
  currency: "NGN",
  amountMinor: 200_000,
  paidAt: "2026-10-01T08:00:00Z",
  periodStart: "2026-10-01T00:00:00Z",
  periodEnd: "2026-11-01T00:00:00Z",
  bankReference: "  GTB-1  ",
  ...overrides,
});

describe("manual payments", () => {
  it("records the period, the ledger entry and an audit entry, keyed by bank reference", () => {
    const update = manualPaymentToUpdate(payment(), ADMIN, new Date("2026-10-02T00:00:00Z"));
    expect(update).toMatchObject({
      provider: "manual",
      event_id: "manual:GTB-1",
      subscription: {
        student_id: STUDENT,
        extend: { from: "2026-10-01T00:00:00.000Z", until: "2026-11-01T00:00:00.000Z" },
      },
      payment: { provider_payment_id: "GTB-1", amount_minor: 200_000, recorded_by: ADMIN },
      audit: { actor_id: ADMIN, action: "payment.manual_recorded" },
    });
  });

  it("rejects a backwards period, a currency the plan isn't sold in, and a zero amount", () => {
    expect(() =>
      manualPaymentToUpdate(payment({ periodEnd: "2026-09-01T00:00:00Z" }), ADMIN),
    ).toThrow(/end after/);
    expect(() => manualPaymentToUpdate(payment({ currency: "GBP" }), ADMIN)).toThrow(/not sold/);
    expect(() => manualPaymentToUpdate(payment({ amountMinor: 0 }), ADMIN)).toThrow();
  });

  it("gives the payer a short, unambiguous transfer reference", async () => {
    expect(newTransferReference()).toMatch(/^KP-[A-HJ-NP-Z2-9]{8}$/);
    const provider = createManualProvider({ store: {} as BillingStore });
    expect(
      await provider.createCheckout({
        target: { kind: "student", studentId: STUDENT },
        planId: "nigeria_weekly",
        currency: "NGN",
        trial: false,
        successUrl: "x",
        cancelUrl: "y",
      }),
    ).toMatchObject({ kind: "manual" });
  });

  it("cancels only with an admin, keeping the paid period", async () => {
    const applyBillingEvent = vi.fn(async () => "applied" as const);
    const provider = createManualProvider({
      store: { applyBillingEvent } as unknown as BillingStore,
    });
    const record = {
      id: STUDENT,
      provider: "manual" as const,
      providerSubscriptionId: null,
      providerCustomerId: null,
      providerMeta: {},
      status: "active" as const,
      currentPeriodEnd: null,
    };
    await expect(provider.cancel(record)).rejects.toThrow(/admin/);
    await provider.cancel(record, { actorId: ADMIN });
    expect(applyBillingEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        subscription: expect.objectContaining({ id: STUDENT, status: "canceled" }),
        audit: expect.objectContaining({ actor_id: ADMIN }),
      }),
    );
    expect(await provider.getManageLink(record, "x")).toBeNull();
    expect(await provider.handleWebhook({ rawBody: "", headers: new Headers() })).toEqual({
      status: "ignored",
    });
  });
});

describe("codes", () => {
  it("makes unguessable, URL-safe sponsor codes", () => {
    const codes = new Set(Array.from({ length: 100 }, newSponsorCode));
    expect(codes.size).toBe(100);
    for (const code of codes) expect(isSponsorCodeShape(code)).toBe(true);
    expect(isSponsorCodeShape("short")).toBe(false);
    expect(isSponsorCodeShape("../../etc/passwd/xxxxxxxxxxx")).toBe(false);
  });

  it("normalises referral codes as people type them", () => {
    expect(normalizeReferralCode(" tola 10 ")).toBe("TOLA10");
    expect(normalizeReferralCode("ab")).toBeNull();
    expect(normalizeReferralCode("tola-10")).toBeNull();
  });
});
