// Finds or creates the Paystack plans for the naira prices in src/config/pricing.ts and prints
// the env lines to paste into .env.local / Vercel.
// Usage: node --env-file=.env.local scripts/paystack-plans.ts
import { PLANS } from "../src/config/pricing.ts";

const key = process.env.PAYSTACK_SECRET_KEY;
if (!key?.startsWith("sk_")) {
  console.error("PAYSTACK_SECRET_KEY is not set in .env.local.");
  process.exit(1);
}

type PaystackPlan = { name: string; plan_code: string; amount: number; interval: string };

async function paystack(method: "GET" | "POST", path: string, body?: unknown) {
  const response = await fetch(`https://api.paystack.co${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = (await response.json()) as { status: boolean; message: string; data: unknown };
  if (!response.ok || !json.status) throw new Error(`${path}: ${json.message}`);
  return json.data;
}

const existing = (await paystack("GET", "/plan?perPage=100")) as PaystackPlan[];

for (const id of ["nigeria_weekly", "nigeria_monthly"] as const) {
  const plan = PLANS[id];
  const amount = plan.prices.NGN;
  const interval = plan.interval === "week" ? "weekly" : "monthly";
  // The amount is in the name, so a price change in config creates a new plan.
  const name = `KinPrep ${id} NGN${amount / 100}`;
  let found = existing.find(
    (p) => p.name === name && p.amount === amount && p.interval === interval,
  );
  if (!found) {
    found = (await paystack("POST", "/plan", {
      name,
      amount,
      interval,
      currency: "NGN",
    })) as PaystackPlan;
    console.error(`Created ${name}`);
  }
  console.log(`PAYSTACK_PLAN_${id.toUpperCase()}=${found.plan_code}`);
}
