import { describe, expect, it } from "vitest";
import { GO_STOP_MEASURES } from "@/config/pilot";
import { billingSettingsFrom, priceOverrides } from "@/lib/payments/billing-settings";
import { CONFIG_PRICES, priceFor } from "@/lib/payments/plans";
import {
  addMonths,
  commissionOn,
  earnsCommission,
  handSentText,
  measureStatus,
  monthBounds,
  monthlyEquivalent,
  monthOf,
  payoutLines,
  previousMonth,
  providerDashboardUrl,
  waMeLink,
  type CommissionPayment,
} from "./rules";

describe("monthly recurring revenue", () => {
  it("turns each plan into a month's money", () => {
    expect(monthlyEquivalent("abroad_monthly", "GBP", null, CONFIG_PRICES)).toBe(600);
    expect(monthlyEquivalent("abroad_yearly", "GBP", null, CONFIG_PRICES)).toBe(458); // 5500 / 12
    expect(monthlyEquivalent("nigeria_weekly", "NGN", null, CONFIG_PRICES)).toBe(216_667); // x 52 / 12
    expect(monthlyEquivalent("bulk_seat_monthly", "GBP", 30, CONFIG_PRICES)).toBe(12_000);
    expect(monthlyEquivalent("old_plan", "GBP", null, CONFIG_PRICES)).toBe(0);
    expect(monthlyEquivalent("abroad_monthly", "NGN", null, CONFIG_PRICES)).toBe(0);
  });
});

describe("go / stop", () => {
  const [sponsors, , , , bulk] = GO_STOP_MEASURES;
  it("is go at or above the go line, stop below the stop line, watch between", () => {
    expect(measureStatus(sponsors, 10)).toBe("go");
    expect(measureStatus(sponsors, 2)).toBe("stop");
    expect(measureStatus(sponsors, 3)).toBe("watch");
    expect(measureStatus(bulk, 0)).toBe("watch"); // no stop line
    expect(measureStatus(bulk, 2)).toBe("go");
  });
});

describe("ambassador commission", () => {
  const first = new Date("2026-01-31T10:00:00Z");
  const pay = (
    id: string,
    at: string,
    amount = 1000,
    o: Partial<CommissionPayment> = {},
  ): CommissionPayment => ({
    paymentId: id,
    ambassadorId: "a",
    currency: "NGN",
    amountMinor: amount,
    occurredAt: new Date(at),
    payerFirstPaidAt: first,
    ...o,
  });

  it("is 20% of each payment in the payer's first three months, rounded down", () => {
    expect(commissionOn(200_000)).toBe(40_000);
    expect(commissionOn(599)).toBe(119);
    expect(addMonths(first, 3).toISOString()).toBe("2026-05-01T10:00:00.000Z"); // 31 Jan + 3 months
    expect(earnsCommission(pay("1", "2026-01-31T10:00:00Z"))).toBe(true);
    expect(earnsCommission(pay("2", "2026-04-30T10:00:00Z"))).toBe(true);
    expect(earnsCommission(pay("3", "2026-05-01T10:00:00Z"))).toBe(false);
    expect(earnsCommission(pay("4", "2026-01-01T10:00:00Z"))).toBe(false); // before their first
  });

  it("keeps an ambassador's currencies apart, in order", () => {
    const lines = payoutLines([
      pay("1", "2026-02-01T00:00:00Z", 200_000),
      pay("2", "2026-02-01T00:00:00Z", 600, { currency: "GBP" }),
    ]);
    expect(lines.map((l) => [l.ambassadorId, l.currency, l.amountMinor])).toEqual([
      ["a", "GBP", 120],
      ["a", "NGN", 40_000],
    ]);
  });

  it("adds up one line per ambassador and currency", () => {
    const lines = payoutLines([
      pay("1", "2026-02-01T00:00:00Z", 200_000),
      pay("2", "2026-03-01T00:00:00Z", 200_000),
      pay("3", "2026-02-01T00:00:00Z", 600, { ambassadorId: "b", currency: "GBP" }),
      pay("4", "2026-09-01T00:00:00Z", 200_000), // too late
      pay("5", "2026-02-01T00:00:00Z", 4), // 20% of 4 kobo rounds to nothing
    ]);
    expect(lines).toEqual([
      {
        ambassadorId: "a",
        currency: "NGN",
        amountMinor: 80_000,
        items: [
          { paymentId: "1", amountMinor: 40_000 },
          { paymentId: "2", amountMinor: 40_000 },
        ],
      },
      {
        ambassadorId: "b",
        currency: "GBP",
        amountMinor: 120,
        items: [{ paymentId: "3", amountMinor: 120 }],
      },
    ]);
  });
});

describe("months", () => {
  it("knows where Lagos months start and end", () => {
    expect(monthBounds("2026-10")).toEqual({ start: "2026-10-01", next: "2026-11-01" });
    expect(monthBounds("2026-12")).toEqual({ start: "2026-12-01", next: "2027-01-01" });
    expect(monthOf("2026-10-11")).toBe("2026-10");
    expect(previousMonth("2026-01")).toBe("2025-12");
  });
});

describe("hand-sent messages", () => {
  it("makes wa.me links with the message ready to send", () => {
    const link = waMeLink("+234 800 000 0001", "Hi Ada & Chidi!\nTap: https://x.test/p/abc");
    expect(link).toBe(
      "https://wa.me/2348000000001?text=Hi%20Ada%20%26%20Chidi!%0ATap%3A%20https%3A%2F%2Fx.test%2Fp%2Fabc",
    );
    expect(new URL(link).searchParams.get("text")).toBe(
      "Hi Ada & Chidi!\nTap: https://x.test/p/abc",
    );
  });

  it("turns a template's button into text: links on their own line, quick replies dropped", () => {
    expect(handSentText("Your report is ready. [Full report: https://k.test/app/r]")).toBe(
      "Your report is ready.\n\nFull report: https://k.test/app/r",
    );
    expect(handSentText("Good morning Ada! Tap Start. [Start]")).toBe(
      "Good morning Ada! Tap Start.",
    );
    expect(handSentText("Plain text")).toBe("Plain text");
  });

  it("links to the payment in Stripe or Paystack for refunds", () => {
    expect(providerDashboardUrl("stripe", "in_123", { stripeTestMode: true })).toBe(
      "https://dashboard.stripe.com/test/search?query=in_123",
    );
    expect(providerDashboardUrl("stripe", "in_123", { stripeTestMode: false })).toBe(
      "https://dashboard.stripe.com/search?query=in_123",
    );
    expect(providerDashboardUrl("paystack", "kp_1", { stripeTestMode: false })).toContain(
      "query=kp_1",
    );
    expect(providerDashboardUrl("manual", "GTB-1", { stripeTestMode: false })).toBeNull();
  });
});

describe("billing settings", () => {
  it("override config prices and grace days, and ignore anything invalid", () => {
    const s = billingSettingsFrom([
      {
        key: "price_overrides",
        value: {
          nigeria_weekly: { NGN: 60_000, GBP: 100 }, // NGN plan isn't sold in GBP: ignored
          abroad_monthly: { GBP: 50 }, // under the 100 minimum: ignored
          gone_plan: { GBP: 700 },
        },
      },
      { key: "grace_days", value: 5 },
    ]);
    expect(s.graceDays).toBe(5);
    expect(s.prices.nigeria_weekly).toEqual({ NGN: 60_000 });
    expect(s.prices.abroad_monthly.GBP).toBe(600);
    expect(priceFor("nigeria_weekly", "NGN", s.prices)).toBe(60_000);
    expect(priceFor("nigeria_weekly", "NGN")).toBe(50_000); // config unchanged
    expect(priceOverrides(s.prices)).toEqual({ nigeria_weekly: { NGN: 60_000 } });
    expect(billingSettingsFrom([{ key: "grace_days", value: 99 }]).graceDays).toBe(3);
    expect(billingSettingsFrom([{ key: "price_overrides", value: "junk" }]).prices).toEqual(
      CONFIG_PRICES,
    );
  });
});
