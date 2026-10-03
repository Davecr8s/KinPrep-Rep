"use server";

import { reportError } from "@/lib/monitoring/report";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { getStudentAccess } from "@/lib/access";
import { serverEnv } from "@/lib/env";
import { isSponsorCodeShape, normalizeReferralCode } from "@/lib/payments/codes";
import { getBillingStore, getPaymentProvider } from "@/lib/payments/server";
import { withinLimit } from "@/lib/security/server";
import type { Referral } from "@/lib/payments/types";

const FormSchema = z.object({
  plan: z.enum(["abroad_monthly", "abroad_yearly"]),
  currency: z.enum(["GBP", "USD", "CAD"]),
  referral: z.string().trim().max(40).optional(),
});

/** Starts Stripe Checkout for the student behind a sponsor link. `code` comes from the URL. */
export async function startSponsorCheckout(code: string, formData: FormData): Promise<never> {
  // Bound arguments reach the client unencrypted, so treat `code` as untrusted input.
  if (!isSponsorCodeShape(code)) notFound();
  const back = (error: string, currency?: string) =>
    redirect(`/sponsor/${code}?error=${error}${currency ? `&currency=${currency}` : ""}`);

  const parsed = FormSchema.safeParse({
    plan: formData.get("plan"),
    currency: formData.get("currency"),
    referral: formData.get("referral") || undefined,
  });
  if (!parsed.success) back("form");
  if (!(await withinLimit("sponsorCheckout"))) back("rate");
  const { plan, currency, referral: referralInput } = parsed.data!;

  const store = getBillingStore();
  const student = await store.findSponsorLink(code);
  if (!student) notFound();
  if ((await getStudentAccess(student.studentId)).state === "active") back("covered");

  let referral: Referral | undefined;
  if (referralInput) {
    const normalized = normalizeReferralCode(referralInput);
    referral = (normalized && (await store.findActiveAmbassador(normalized))) || undefined;
    if (!referral) back("referral", currency);
  }

  const appUrl = serverEnv("app").NEXT_PUBLIC_APP_URL;
  let url: string;
  try {
    const result = await getPaymentProvider("stripe").createCheckout({
      target: { kind: "student", studentId: student.studentId },
      planId: plan,
      currency,
      referral,
      // One free trial per student.
      trial: !(await store.hasAnySubscription(student.studentId)),
      successUrl: `${appUrl}/sponsor/${code}/thanks`,
      cancelUrl: `${appUrl}/sponsor/${code}?currency=${currency}`,
    });
    if (result.kind !== "redirect") throw new Error("Stripe checkout did not return a URL");
    url = result.url;
  } catch (error) {
    await reportError({ where: "action:sponsor", error });
    back("checkout", currency);
  }
  redirect(url!);
}
