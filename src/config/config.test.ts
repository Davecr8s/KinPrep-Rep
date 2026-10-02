import { describe, expect, it } from "vitest";
import { GO_STOP_MEASURES, QUESTIONS_PER_DAY, STREAK_DAY_THRESHOLD, SUBJECTS } from "./pilot";
import { AMBASSADOR_COMMISSION, GRACE_DAYS, PLANS, TRIAL_DAYS } from "./pricing";

describe("pricing config", () => {
  it("matches the brief's base prices", () => {
    expect(PLANS.abroad_monthly.prices.GBP).toBe(600);
    expect(PLANS.abroad_yearly.prices.GBP).toBe(5500);
    expect(PLANS.nigeria_weekly.prices.NGN).toBe(50_000);
    expect(PLANS.nigeria_monthly.prices.NGN).toBe(200_000);
    expect(PLANS.bulk_seat_monthly.prices.GBP).toBe(400);
    expect(TRIAL_DAYS).toBe(7);
    expect(GRACE_DAYS).toBe(3);
    expect(AMBASSADOR_COMMISSION).toEqual({ rateBps: 2000, firstMonths: 3 });
  });

  it("uses positive integer minor units for every price", () => {
    for (const plan of Object.values(PLANS)) {
      for (const amount of Object.values(plan.prices)) {
        expect(Number.isInteger(amount)).toBe(true);
        expect(amount).toBeGreaterThan(0);
      }
    }
  });

  it("charges Nigerian plans only in naira and abroad plans never in naira", () => {
    for (const plan of Object.values(PLANS)) {
      const currencies = Object.keys(plan.prices);
      if (plan.region === "nigeria") expect(currencies).toEqual(["NGN"]);
      else expect(currencies).not.toContain("NGN");
    }
  });
});

describe("pilot config", () => {
  it("keeps questions per day within the hard cap of 20", () => {
    expect(QUESTIONS_PER_DAY.max).toBe(20);
    expect(QUESTIONS_PER_DAY.default).toBeLessThanOrEqual(QUESTIONS_PER_DAY.max);
  });

  it("makes a streak day reachable with the default daily questions", () => {
    expect(STREAK_DAY_THRESHOLD).toBeLessThanOrEqual(QUESTIONS_PER_DAY.default);
  });

  it("covers the four pilot subjects", () => {
    expect(SUBJECTS).toEqual(["english", "mathematics", "physics", "biology"]);
  });

  it("sets every stop line below its go line", () => {
    for (const measure of GO_STOP_MEASURES) {
      if ("stopBelow" in measure) expect(measure.stopBelow).toBeLessThan(measure.go);
      if ("outOf" in measure) expect(measure.go).toBeLessThanOrEqual(measure.outOf);
      if (measure.unit === "percent") expect(measure.go).toBeLessThanOrEqual(100);
    }
  });
});
