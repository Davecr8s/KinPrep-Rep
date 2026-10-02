import { describe, expect, it } from "vitest";
import { GRACE_DAYS } from "@/config/pricing";
import { coverageWindow, evaluateAccess, type Coverage } from "./access";

const d = (iso: string) => new Date(iso);
const DAY = 24 * 60 * 60 * 1000;

function coverage(overrides: Partial<Coverage>): Coverage {
  return {
    status: "active",
    currentPeriodEnd: null,
    trialEnd: null,
    graceUntil: null,
    ...overrides,
  };
}

const periodEnd = d("2026-11-01T10:00:00Z");
const graceEnd = new Date(periodEnd.getTime() + GRACE_DAYS * DAY);

describe("evaluateAccess", () => {
  it("is inactive with no coverage", () => {
    expect(evaluateAccess([], d("2026-10-01T00:00:00Z"))).toEqual({
      state: "inactive",
      until: null,
    });
  });

  describe("active subscription", () => {
    const active = coverage({ status: "active", currentPeriodEnd: periodEnd });

    it("is active until the period ends", () => {
      expect(evaluateAccess([active], d("2026-10-15T00:00:00Z"))).toEqual({
        state: "active",
        until: periodEnd,
      });
    });

    it("falls into grace when the renewal hasn't arrived, for exactly GRACE_DAYS", () => {
      expect(evaluateAccess([active], periodEnd)).toEqual({ state: "grace", until: graceEnd });
      expect(evaluateAccess([active], new Date(graceEnd.getTime() - 1)).state).toBe("grace");
      expect(evaluateAccess([active], graceEnd).state).toBe("inactive");
    });

    it("is inactive if it has no period end", () => {
      expect(evaluateAccess([coverage({ status: "active" })], periodEnd).state).toBe("inactive");
    });
  });

  describe("trial", () => {
    const trialEnd = d("2026-10-08T10:00:00Z");

    it("is active until the trial ends, then grace", () => {
      const trial = coverage({ status: "trialing", trialEnd, currentPeriodEnd: trialEnd });
      expect(evaluateAccess([trial], d("2026-10-07T00:00:00Z"))).toEqual({
        state: "active",
        until: trialEnd,
      });
      expect(evaluateAccess([trial], trialEnd).state).toBe("grace");
    });

    it("uses the period end when the trial end is missing", () => {
      const trial = coverage({ status: "trialing", currentPeriodEnd: trialEnd });
      expect(evaluateAccess([trial], d("2026-10-07T00:00:00Z")).until).toEqual(trialEnd);
    });
  });

  describe("failed payment (past_due)", () => {
    const failedAt = d("2026-11-01T11:00:00Z");
    const graceUntil = new Date(failedAt.getTime() + GRACE_DAYS * DAY);
    const pastDue = coverage({
      status: "past_due",
      currentPeriodEnd: d("2026-12-01T10:00:00Z"),
      graceUntil,
    });

    it("moves straight to grace, ignoring the unpaid new period", () => {
      expect(evaluateAccess([pastDue], failedAt)).toEqual({ state: "grace", until: graceUntil });
    });

    it("becomes inactive when grace ends", () => {
      expect(evaluateAccess([pastDue], graceUntil)).toEqual({ state: "inactive", until: null });
    });

    it("falls back to GRACE_DAYS after the period end if no grace deadline was stored", () => {
      const noGrace = coverage({ status: "past_due", currentPeriodEnd: periodEnd });
      expect(evaluateAccess([noGrace], periodEnd)).toEqual({ state: "grace", until: graceEnd });
    });

    it("is inactive with neither a grace deadline nor a period end", () => {
      expect(evaluateAccess([coverage({ status: "past_due" })], periodEnd).state).toBe("inactive");
    });
  });

  describe("canceled subscription", () => {
    const canceled = coverage({ status: "canceled", currentPeriodEnd: periodEnd });

    it("keeps the time already paid for", () => {
      expect(evaluateAccess([canceled], d("2026-10-20T00:00:00Z"))).toEqual({
        state: "active",
        until: periodEnd,
      });
    });

    it("ends with no grace period", () => {
      expect(evaluateAccess([canceled], periodEnd).state).toBe("inactive");
    });
  });

  it("never gives access for an incomplete checkout", () => {
    const incomplete = coverage({
      status: "incomplete",
      currentPeriodEnd: periodEnd,
      graceUntil: graceEnd,
    });
    expect(evaluateAccess([incomplete], d("2026-10-15T00:00:00Z")).state).toBe("inactive");
  });

  describe("several coverages (own subscription plus a group seat)", () => {
    const now = d("2026-11-02T00:00:00Z");
    const inGrace = coverage({ status: "past_due", graceUntil: d("2026-11-04T00:00:00Z") });
    const seat = coverage({ status: "active", currentPeriodEnd: d("2026-11-20T00:00:00Z") });
    const longerSeat = coverage({ status: "active", currentPeriodEnd: d("2026-12-20T00:00:00Z") });
    const laterGrace = coverage({ status: "past_due", graceUntil: d("2026-11-05T00:00:00Z") });
    const expired = coverage({ status: "canceled", currentPeriodEnd: d("2026-10-01T00:00:00Z") });

    it("prefers active over grace, whatever the order", () => {
      expect(evaluateAccess([inGrace, seat], now).state).toBe("active");
      expect(evaluateAccess([seat, inGrace], now).state).toBe("active");
    });

    it("reports the latest end among equally good coverages", () => {
      expect(evaluateAccess([seat, longerSeat], now).until).toEqual(longerSeat.currentPeriodEnd);
      expect(evaluateAccess([longerSeat, seat], now).until).toEqual(longerSeat.currentPeriodEnd);
      expect(evaluateAccess([inGrace, laterGrace], now).until).toEqual(laterGrace.graceUntil);
    });

    it("ignores expired coverage", () => {
      expect(evaluateAccess([expired, inGrace], now)).toEqual({
        state: "grace",
        until: inGrace.graceUntil,
      });
    });
  });
});

describe("KinPrep free trial", () => {
  const trialEnd = d("2026-10-08T10:00:00Z");

  it("is active until it ends, then inactive with no grace", () => {
    const trial = coverage({ provider: "trial", status: "trialing", trialEnd });
    expect(evaluateAccess([trial], d("2026-10-07T00:00:00Z"))).toEqual({
      state: "active",
      until: trialEnd,
    });
    expect(evaluateAccess([trial], trialEnd).state).toBe("inactive");
  });

  it("falls back to the period end, and never covers when incomplete", () => {
    const noTrialEnd = coverage({
      provider: "trial",
      status: "trialing",
      currentPeriodEnd: trialEnd,
    });
    expect(evaluateAccess([noTrialEnd], d("2026-10-07T00:00:00Z")).until).toEqual(trialEnd);
    const incomplete = coverage({ provider: "trial", status: "incomplete", trialEnd });
    expect(evaluateAccess([incomplete], d("2026-10-07T00:00:00Z")).state).toBe("inactive");
  });
});

describe("coverageWindow", () => {
  it("gives no paid time or grace for incomplete", () => {
    expect(coverageWindow(coverage({ status: "incomplete" }))).toEqual({
      paidThrough: null,
      graceEnd: null,
    });
  });
});
