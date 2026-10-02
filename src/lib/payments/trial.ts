import { TRIAL_DAYS } from "@/config/pricing";
import type { BillingStore } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * KinPrep's own no-card free trial, for naira payers (Stripe sponsors get theirs inside Stripe
 * Checkout). One per student: the event id makes a second start a no-op, and the trial row also
 * counts as "has had a subscription", so a later Stripe checkout won't add another trial.
 */
export async function startFreeTrial(
  store: Pick<BillingStore, "applyBillingEvent">,
  studentId: string,
  now: Date = new Date(),
): Promise<"applied" | "duplicate"> {
  const trialEnd = new Date(now.getTime() + TRIAL_DAYS * DAY_MS).toISOString();
  return store.applyBillingEvent({
    provider: "trial",
    event_id: `trial:${studentId}`,
    event_type: "trial.started",
    occurred_at: now.toISOString(),
    payload: { student_id: studentId },
    subscription: {
      student_id: studentId,
      plan: "nigeria_weekly",
      currency: "NGN",
      status: "trialing",
      trial_end: trialEnd,
      current_period_end: trialEnd,
    },
  });
}
