import { z } from "zod";
import { GRACE_DAYS, PLANS, type Currency, type PlanId } from "@/config/pricing";
import { CONFIG_PRICES, type PriceTable } from "./plans";

// Prices and the grace period as admin settings (/admin/settings), over the defaults in
// src/config/pricing.ts. Settings keys: "price_overrides" ({plan: {currency: minor units}}) and
// "grace_days". Only currencies a plan is already sold in can be changed.

export type BillingSettings = { prices: PriceTable; graceDays: number };

export const DEFAULT_BILLING: BillingSettings = { prices: CONFIG_PRICES, graceDays: GRACE_DAYS };

export const MAX_GRACE_DAYS = 14;
const amount = z.number().int().min(100).max(100_000_000);

/** Settings rows to effective billing settings; anything invalid falls back to the default. */
export function billingSettingsFrom(
  rows: readonly { key: string; value: unknown }[],
): BillingSettings {
  const value = (key: string) => rows.find((r) => r.key === key)?.value;
  const prices: PriceTable = structuredClone(CONFIG_PRICES);
  const overrides = z
    .record(z.string(), z.record(z.string(), z.unknown()))
    .safeParse(value("price_overrides"));
  if (overrides.success) {
    for (const [plan, byCurrency] of Object.entries(overrides.data)) {
      if (!(plan in PLANS)) continue;
      for (const [currency, minor] of Object.entries(byCurrency)) {
        const sold: Partial<Record<Currency, number>> = PLANS[plan as PlanId].prices;
        const parsed = amount.safeParse(minor);
        if (currency in sold && parsed.success) {
          prices[plan as PlanId][currency as Currency] = parsed.data;
        }
      }
    }
  }
  const grace = Number(value("grace_days"));
  return {
    prices,
    graceDays:
      Number.isInteger(grace) && grace >= 0 && grace <= MAX_GRACE_DAYS ? grace : GRACE_DAYS,
  };
}

/** Only the prices that differ from the config, as stored in "price_overrides". */
export function priceOverrides(prices: PriceTable): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const [plan, byCurrency] of Object.entries(prices)) {
    for (const [currency, minor] of Object.entries(byCurrency)) {
      if (CONFIG_PRICES[plan as PlanId][currency as Currency] !== minor) {
        (out[plan] ??= {})[currency] = minor!;
      }
    }
  }
  return out;
}
