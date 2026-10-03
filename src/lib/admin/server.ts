import "server-only";
import Stripe from "stripe";
import { z } from "zod";
import { parseEnvGroup } from "@/lib/env";
import type { PayoutClients } from "./money";

// Production wiring for ambassador payouts: Paystack Transfers (Nigerian bank accounts) and
// Stripe Connect Express (UK accounts). Each works on its own once its keys are set.

const PAYSTACK = "https://api.paystack.co";

function paystackKey(): string | null {
  try {
    return parseEnvGroup("paystack", process.env).PAYSTACK_SECRET_KEY;
  } catch {
    return null;
  }
}

function stripe(): Stripe | null {
  try {
    return new Stripe(parseEnvGroup("stripe", process.env).STRIPE_SECRET_KEY);
  } catch {
    return null;
  }
}

async function paystack(path: string, body: unknown): Promise<Record<string, unknown>> {
  const key = paystackKey();
  if (!key) throw new Error("Paystack isn't set up (PAYSTACK_SECRET_KEY).");
  const response = await fetch(`${PAYSTACK}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await response.json().catch(() => null)) as {
    status?: boolean;
    message?: string;
    data?: Record<string, unknown>;
  } | null;
  if (!response.ok || !json?.status || !json.data) {
    throw new Error(`Paystack: ${json?.message ?? `request failed (${response.status})`}`);
  }
  return json.data;
}

export function payoutClients(): PayoutClients {
  return {
    async paystackTransfer(t) {
      const data = await paystack("/transfer", {
        source: "balance",
        currency: "NGN",
        amount: t.amountMinor,
        recipient: t.recipientCode,
        reference: t.reference,
        reason: t.reason,
      });
      const status = String(data.status ?? "");
      // "success" now; "pending" or "otp" (approve it in the Paystack dashboard) later.
      return {
        status: status === "success" ? "paid" : "sending",
        ref: String(data.transfer_code ?? data.reference ?? t.reference),
      };
    },
    async stripeTransfer(t) {
      const client = stripe();
      if (!client) throw new Error("Stripe isn't set up (STRIPE_SECRET_KEY).");
      const transfer = await client.transfers.create(
        {
          amount: t.amountMinor,
          currency: t.currency.toLowerCase(),
          destination: t.accountId,
          description: t.description,
        },
        { idempotencyKey: t.idempotencyKey },
      );
      return { ref: transfer.id };
    },
  };
}

const RecipientSchema = z.object({
  recipient_code: z.string().startsWith("RCP_"),
  details: z
    .object({ bank_name: z.string().nullish(), account_number: z.string().nullish() })
    .optional(),
});

/** Registers a Nigerian bank account with Paystack; only the recipient code is kept. */
export async function createPaystackRecipient(input: {
  name: string;
  accountNumber: string;
  bankCode: string;
}): Promise<{ recipientCode: string; bankName: string; accountLast4: string }> {
  const data = RecipientSchema.parse(
    await paystack("/transferrecipient", {
      type: "nuban",
      name: input.name,
      account_number: input.accountNumber,
      bank_code: input.bankCode,
      currency: "NGN",
    }),
  );
  return {
    recipientCode: data.recipient_code,
    bankName: data.details?.bank_name ?? `Bank ${input.bankCode}`,
    accountLast4: input.accountNumber.slice(-4),
  };
}

/** A Stripe Connect Express account for a UK ambassador, and the link to finish setting it up. */
export async function stripeOnboarding(input: {
  accountId: string | null;
  email: string | null;
  returnUrl: string;
}): Promise<{ accountId: string; url: string }> {
  const client = stripe();
  if (!client) throw new Error("Stripe isn't set up (STRIPE_SECRET_KEY).");
  const accountId =
    input.accountId ??
    (
      await client.accounts.create({
        type: "express",
        country: "GB",
        ...(input.email ? { email: input.email } : {}),
        capabilities: { transfers: { requested: true } },
      })
    ).id;
  const link = await client.accountLinks.create({
    account: accountId,
    refresh_url: input.returnUrl,
    return_url: input.returnUrl,
    type: "account_onboarding",
  });
  return { accountId, url: link.url };
}

export function stripeTestMode(): boolean {
  return (process.env.STRIPE_SECRET_KEY ?? "").startsWith("sk_test_");
}
