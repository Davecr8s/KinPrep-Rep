// Single source of truth for prices and billing periods. Never hard-code these elsewhere.
// Amounts are integers in minor units (pence, cents, kobo), the format Stripe and Paystack expect.

export const CURRENCIES = ["GBP", "USD", "CAD", "NGN"] as const;
export type Currency = (typeof CURRENCIES)[number];

export type Region = "abroad" | "nigeria" | "group";
export type BillingInterval = "week" | "month" | "year";

export type Plan = {
  region: Region;
  interval: BillingInterval;
  prices: Partial<Record<Currency, number>>;
  perSeat?: boolean;
};

export const PLANS = {
  abroad_monthly: {
    region: "abroad",
    interval: "month",
    // USD and CAD amounts are PROVISIONAL until confirmed (BUILD_PLAN decision 6).
    prices: { GBP: 600, USD: 800, CAD: 1100 },
  },
  abroad_yearly: {
    region: "abroad",
    interval: "year",
    // USD and CAD amounts are PROVISIONAL until confirmed (BUILD_PLAN decision 6).
    prices: { GBP: 5500, USD: 7200, CAD: 9900 },
  },
  nigeria_weekly: {
    region: "nigeria",
    interval: "week",
    prices: { NGN: 50_000 },
  },
  nigeria_monthly: {
    region: "nigeria",
    interval: "month",
    prices: { NGN: 200_000 },
  },
  bulk_seat_monthly: {
    region: "group",
    interval: "month",
    prices: { GBP: 400 },
    perSeat: true,
  },
} as const satisfies Record<string, Plan>;

export type PlanId = keyof typeof PLANS;

export const TRIAL_DAYS = 7;
export const GRACE_DAYS = 3;

export const AMBASSADOR_COMMISSION = {
  // Basis points: 2000 = 20%. Kept as an integer to avoid floating-point money maths.
  rateBps: 2000,
  firstMonths: 3,
} as const;
