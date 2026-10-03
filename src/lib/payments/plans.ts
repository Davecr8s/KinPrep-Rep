import { z } from "zod";
import {
  CURRENCIES,
  PLANS,
  type BillingInterval,
  type Currency,
  type Plan,
  type PlanId,
} from "@/config/pricing";

export const PlanIdSchema = z.enum(Object.keys(PLANS) as [PlanId, ...PlanId[]]);
export const CurrencySchema = z.enum(CURRENCIES);

export const PLAN_LABELS: Record<PlanId, string> = {
  abroad_monthly: "KinPrep monthly",
  abroad_yearly: "KinPrep yearly",
  nigeria_weekly: "KinPrep weekly",
  nigeria_monthly: "KinPrep monthly",
  bulk_seat_monthly: "KinPrep group seat, monthly",
};

export type PriceTable = Record<PlanId, Partial<Record<Currency, number>>>;

/** The prices in src/config/pricing.ts; admin settings can override them (billing-settings.ts). */
export const CONFIG_PRICES: PriceTable = Object.fromEntries(
  Object.entries(PLANS).map(([id, plan]) => [id, { ...plan.prices }]),
) as PriceTable;

/** Price in minor units for a plan in a currency; throws if the plan isn't sold in it. */
export function priceFor(
  planId: PlanId,
  currency: Currency,
  prices: PriceTable = CONFIG_PRICES,
): number {
  const amount = prices[planId][currency];
  if (amount === undefined) {
    throw new Error(`Plan ${planId} is not sold in ${currency}`);
  }
  return amount;
}

export function intervalOf(planId: PlanId): BillingInterval {
  return PLANS[planId].interval;
}

/** The plan's billing period as a Postgres interval, used to extend pay-per-period coverage. */
export function pgIntervalOf(planId: PlanId): string {
  const intervals: Record<BillingInterval, string> = {
    week: "7 days",
    month: "1 month",
    year: "1 year",
  };
  return intervals[intervalOf(planId)];
}

export function isPerSeat(planId: PlanId): boolean {
  const plan: Plan = PLANS[planId];
  return plan.perSeat === true;
}
