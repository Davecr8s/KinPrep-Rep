"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireOwnedStudent, requirePayer } from "@/lib/auth";
import { adminDb } from "@/lib/db/admin";
import { serverEnv } from "@/lib/env";
import { SUBSCRIPTION_COLUMNS, toSubscriptionRecord } from "@/lib/payments/rows";
import { getPaymentProvider } from "@/lib/payments/server";
import { BillingCancelError, deleteStudentData } from "@/lib/services/data-rights";
import { newToken } from "@/lib/tokens";
import { fieldErrors, ReportSettingsSchema } from "@/lib/validation/forms";

const VIEWER_INVITE_DAYS = 7;

export async function updateReportSettings(formData: FormData): Promise<never> {
  const { user, payer } = await requirePayer();
  const parsed = ReportSettingsSchema.safeParse({
    reportWeekday: formData.get("reportWeekday"),
    reportHour: formData.get("reportHour"),
    whatsapp: formData.get("whatsapp"),
    reportsOptIn: formData.get("reportsOptIn"),
    country: payer.region === "nigeria" ? "NG" : "GB",
  });
  if (!parsed.success) {
    const first = Object.keys(fieldErrors(parsed.error))[0] ?? "form";
    redirect(`/app/settings?error=${first}#reports`);
  }
  const s = parsed.data!;
  const { error } = await adminDb()
    .from("payers")
    .update({
      report_weekday: s.reportWeekday,
      report_hour: s.reportHour,
      whatsapp_number: s.whatsapp,
      // Keep the original opt-in time while it stays ticked.
      whatsapp_reports_opt_in_at: s.reportsOptIn
        ? (payer.whatsapp_reports_opt_in_at ?? new Date().toISOString())
        : null,
    })
    .eq("id", user.id);
  if (error) throw new Error(error.message);
  redirect("/app/settings?saved=reports#reports");
}

/** Stripe's customer portal or Paystack's manage page, for card changes and cancelling. */
export async function openBillingPortal(subscriptionId: string): Promise<never> {
  await requirePayer();
  if (!z.uuid().safeParse(subscriptionId).success) redirect("/app/settings");
  const { data, error } = await adminDb()
    .from("subscriptions")
    .select(`${SUBSCRIPTION_COLUMNS}, student_id`)
    .eq("id", subscriptionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.student_id) redirect("/app/settings");
  await requireOwnedStudent(data.student_id as string);
  const record = toSubscriptionRecord(data);
  if (record.provider !== "stripe" && record.provider !== "paystack")
    redirect("/app/settings#billing");
  const link = await getPaymentProvider(record.provider).getManageLink(
    record,
    `${serverEnv("app").NEXT_PUBLIC_APP_URL}/app/settings`,
  );
  redirect(link ?? "/app/settings?error=portal#billing");
}

export async function inviteCoSponsor(studentId: string): Promise<never> {
  const { user } = await requireOwnedStudent(studentId);
  const { token, hash } = newToken();
  const { error } = await adminDb()
    .from("viewer_invites")
    .insert({
      student_id: studentId,
      token_hash: hash,
      invited_by: user.id,
      expires_at: new Date(Date.now() + VIEWER_INVITE_DAYS * 86_400_000).toISOString(),
    });
  if (error) throw new Error(error.message);
  redirect(`/app/settings?invite=${token}&child=${studentId}#sharing`);
}

export async function removeCoSponsors(studentId: string): Promise<never> {
  await requireOwnedStudent(studentId);
  const db = adminDb();
  const { error } = await db.from("student_viewers").delete().eq("student_id", studentId);
  if (error) throw new Error(error.message);
  await db
    .from("viewer_invites")
    .update({ expires_at: new Date().toISOString() })
    .eq("student_id", studentId)
    .is("accepted_at", null);
  redirect("/app/settings?saved=sharing#sharing");
}

export async function deleteChild(studentId: string, formData: FormData): Promise<never> {
  const { user, firstName } = await requireOwnedStudent(studentId);
  const typed = String(formData.get("confirm") ?? "").trim();
  if (typed.toLowerCase() !== firstName.toLowerCase()) {
    redirect(`/app/settings?error=confirm&child=${studentId}#data`);
  }
  try {
    await deleteStudentData(studentId, user.id);
  } catch (error) {
    if (error instanceof BillingCancelError) {
      console.error("[delete] billing cancel failed", error);
      redirect(`/app/settings?error=billing&child=${studentId}#data`);
    }
    throw error;
  }
  redirect("/app/settings?saved=deleted#data");
}
