import { GRACE_DAYS } from "@/config/pricing";

// Pure access rules. isStudentActive (src/lib/access.ts) loads a student's coverages and asks
// this module; nothing else in the app decides whether a student has access.

export type SubscriptionStatus = "incomplete" | "trialing" | "active" | "past_due" | "canceled";

/** One thing that can give a student access: their own subscription or a group seat. */
export type Coverage = {
  status: SubscriptionStatus;
  currentPeriodEnd: Date | null;
  trialEnd: Date | null;
  graceUntil: Date | null;
};

export type AccessState = "active" | "grace" | "inactive";
export type Access = { state: AccessState; until: Date | null };

const DAY_MS = 24 * 60 * 60 * 1000;

function addDays(date: Date | null, days: number): Date | null {
  return date ? new Date(date.getTime() + days * DAY_MS) : null;
}

/**
 * When a coverage stops being paid for, and when its grace period ends.
 * - trialing / active: paid until the trial or period end, then GRACE_DAYS of grace. The grace
 *   also covers a renewal webhook arriving late and Nigerian payers renewing by transfer late.
 * - past_due (a payment failed): no paid time left; grace until grace_until (set GRACE_DAYS after
 *   the first failure), falling back to GRACE_DAYS after the period end.
 * - canceled: keeps the time already paid for, with no grace afterwards.
 * - incomplete: never gave access (checkout not finished, or paused).
 */
export function coverageWindow(coverage: Coverage): {
  paidThrough: Date | null;
  graceEnd: Date | null;
} {
  switch (coverage.status) {
    case "trialing": {
      const end = coverage.trialEnd ?? coverage.currentPeriodEnd;
      return { paidThrough: end, graceEnd: addDays(end, GRACE_DAYS) };
    }
    case "active":
      return {
        paidThrough: coverage.currentPeriodEnd,
        graceEnd: addDays(coverage.currentPeriodEnd, GRACE_DAYS),
      };
    case "past_due":
      return {
        paidThrough: null,
        graceEnd: coverage.graceUntil ?? addDays(coverage.currentPeriodEnd, GRACE_DAYS),
      };
    case "canceled":
      return { paidThrough: coverage.currentPeriodEnd, graceEnd: null };
    case "incomplete":
      return { paidThrough: null, graceEnd: null };
  }
}

const RANK: Record<AccessState, number> = { inactive: 0, grace: 1, active: 2 };

/** The best access any coverage gives at `now`, and until when it lasts. */
export function evaluateAccess(coverages: readonly Coverage[], now: Date): Access {
  let best: Access = { state: "inactive", until: null };
  for (const coverage of coverages) {
    const { paidThrough, graceEnd } = coverageWindow(coverage);
    let candidate: Access;
    if (paidThrough && now < paidThrough) {
      candidate = { state: "active", until: paidThrough };
    } else if (graceEnd && now < graceEnd) {
      candidate = { state: "grace", until: graceEnd };
    } else {
      continue;
    }
    const better =
      RANK[candidate.state] > RANK[best.state] ||
      (candidate.state === best.state && candidate.until! > best.until!);
    if (better) best = candidate;
  }
  return best;
}
