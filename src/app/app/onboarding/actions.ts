"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { adminDb } from "@/lib/db/admin";
import { safeNextPath } from "@/lib/tokens";
import { fieldErrors, OnboardingSchema } from "@/lib/validation/forms";

export type OnboardingState = { errors: Record<string, string>; values: Record<string, string> };

export async function completeOnboarding(
  _prev: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const user = await requireUser();
  const values = Object.fromEntries(
    ["payerType", "currency", "timezone", "whatsapp", "reportsOptIn"].map((k) => [
      k,
      String(formData.get(k) ?? ""),
    ]),
  );
  const parsed = OnboardingSchema.safeParse({
    ...values,
    currency: values.currency || undefined,
    payerType: values.payerType || undefined,
  });
  if (!parsed.success) return { errors: fieldErrors(parsed.error), values };
  const input = parsed.data;
  const db = adminDb();

  // Create the profile; never downgrade an existing role (an admin may also pay for a child).
  const { data: profile, error: profileError } = await db
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError) throw new Error(profileError.message);
  const role = input.payerType === "group" ? "group_buyer" : "payer";
  if (!profile) {
    const { error } = await db.from("profiles").insert({ id: user.id, role });
    if (error) throw new Error(error.message);
  } else if (profile.role === "payer" && role === "group_buyer") {
    const { error } = await db.from("profiles").update({ role }).eq("id", user.id);
    if (error) throw new Error(error.message);
  }

  const { error } = await db.from("payers").upsert({
    id: user.id,
    payer_type: input.payerType,
    region: input.region,
    currency: input.currency,
    timezone: input.timezone,
    whatsapp_number: input.whatsapp ?? null,
    whatsapp_reports_opt_in_at: input.reportsOptIn ? new Date().toISOString() : null,
  });
  if (error) throw new Error(error.message);

  const next = safeNextPath(formData.get("next"), "");
  redirect(next || (input.payerType === "group" ? "/app/groups" : "/app/children/new"));
}
