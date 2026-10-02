"use server";

import { redirect, unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { requireOwnedStudent } from "@/lib/auth";
import { manualBankDetails } from "@/lib/data/settings";
import { serverEnv } from "@/lib/env";
import { getBillingStore, getPaymentProvider } from "@/lib/payments/server";
import type { CheckoutResult } from "@/lib/payments/types";

const AbroadSchema = z.object({
  plan: z.enum(["abroad_monthly", "abroad_yearly"]),
  currency: z.enum(["GBP", "USD", "CAD"]),
});
const NigeriaSchema = z.object({
  plan: z.enum(["nigeria_weekly", "nigeria_monthly"]),
  method: z.enum(["card", "transfer", "manual"]),
});

/** Starts payment for one child through the payments layer, then redirects to the provider. */
export async function startPlanCheckout(studentId: string, formData: FormData): Promise<never> {
  const { user, payer } = await requireOwnedStudent(studentId);
  const planPage = `/app/children/${studentId}/plan`;
  const appUrl = serverEnv("app").NEXT_PUBLIC_APP_URL;
  const common = {
    target: { kind: "student" as const, studentId },
    payerEmail: user.email ?? undefined,
    payerId: user.id,
    successUrl: `${appUrl}/app/children/${studentId}?paid=1`,
    cancelUrl: `${appUrl}${planPage}`,
  };

  const abroad = AbroadSchema.safeParse({
    plan: formData.get("plan"),
    currency: formData.get("currency"),
  });
  const nigeria = NigeriaSchema.safeParse({
    plan: formData.get("plan"),
    method: formData.get("method"),
  });
  if (payer.region === "abroad" ? !abroad.success : !nigeria.success)
    redirect(`${planPage}?error=form`);
  if (
    payer.region === "nigeria" &&
    nigeria.data!.method === "manual" &&
    !(await manualBankDetails())
  ) {
    redirect(`${planPage}?error=form`);
  }

  let result: CheckoutResult;
  try {
    if (payer.region === "abroad") {
      result = await getPaymentProvider("stripe").createCheckout({
        ...common,
        planId: abroad.data!.plan,
        currency: abroad.data!.currency,
        // One free trial per student, whoever pays.
        trial: !(await getBillingStore().hasAnySubscription(studentId)),
      });
    } else {
      const { plan, method } = nigeria.data!;
      result = await getPaymentProvider(method === "manual" ? "manual" : "paystack").createCheckout(
        {
          ...common,
          planId: plan,
          currency: "NGN",
          // Naira payers already had KinPrep's own free trial.
          trial: false,
          channel: method === "card" ? "card" : "bank_transfer_or_ussd",
        },
      );
    }
  } catch (error) {
    unstable_rethrow(error);
    console.error("[plan] checkout failed", error);
    redirect(`${planPage}?error=checkout`);
  }

  if (result.kind === "manual") {
    redirect(`${planPage}?transfer=${result.reference}&plan=${nigeria.data!.plan}`);
  }
  redirect(result.url);
}
