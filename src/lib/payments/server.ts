import "server-only";
import Stripe from "stripe";
import { adminDb } from "@/lib/db/admin";
import { serverEnv } from "@/lib/env";
import { createManualProvider } from "./manual";
import { createPaystackProvider } from "./paystack";
import { createStripeProvider } from "./stripe";
import { createSupabaseBillingStore } from "./supabase-store";
import type { BillingStore, PaymentProvider, ProviderId } from "./types";

// The only place providers are built from environment variables. The rest of the app asks for
// a PaymentProvider and never imports Stripe or Paystack directly.

let store: BillingStore | undefined;
let stripe: Stripe | undefined;

export function getBillingStore(): BillingStore {
  store ??= createSupabaseBillingStore(adminDb());
  return store;
}

export function getPaymentProvider(id: ProviderId): PaymentProvider {
  switch (id) {
    case "stripe": {
      const env = serverEnv("stripe");
      // The SDK pins its API version; the webhook endpoint must use the same version.
      stripe ??= new Stripe(env.STRIPE_SECRET_KEY);
      return createStripeProvider({
        api: stripe,
        store: getBillingStore(),
        webhookSecret: env.STRIPE_WEBHOOK_SECRET,
      });
    }
    case "paystack": {
      const env = serverEnv("paystack");
      return createPaystackProvider({
        secretKey: env.PAYSTACK_SECRET_KEY,
        planCodes: {
          nigeria_weekly: env.PAYSTACK_PLAN_NIGERIA_WEEKLY,
          nigeria_monthly: env.PAYSTACK_PLAN_NIGERIA_MONTHLY,
        },
        store: getBillingStore(),
      });
    }
    case "manual":
      return createManualProvider({ store: getBillingStore() });
  }
}
