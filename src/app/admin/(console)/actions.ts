"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { adminMember, AdminError, audit } from "@/lib/admin/common";
import { markSent, saveSettings, SettingsInputSchema } from "@/lib/admin/console";
import {
  AmbassadorInputSchema,
  confirmBatch,
  discardBatch,
  markPayoutPaid,
  prepareBatch,
  saveAmbassador,
  setPayoutDestination,
} from "@/lib/admin/money";
import { createPaystackRecipient, payoutClients, stripeOnboarding } from "@/lib/admin/server";
import { changeClass, mergeStudents, pauseStudent, resumeStudent } from "@/lib/admin/students";
import { flagExplanation } from "@/lib/ai/admin";
import { requireAdmin } from "@/lib/auth";
import { appSql } from "@/lib/db/postgres";
import { serverEnv } from "@/lib/env";
import { prepareManual, type ManualJob } from "@/lib/jobs/jobs";
import { ManualPaymentSchema, recordManualPayment } from "@/lib/payments/manual";
import { getBillingStore } from "@/lib/payments/server";
import { BillingCancelError, deleteStudentData } from "@/lib/services/data-rights";

// Server actions for /admin. Each checks the admin role again (adminMember) and writes audit_log.

async function admin(path: string) {
  const user = await requireAdmin(path);
  return adminMember(appSql(), user.id);
}

function go(path: string, params: Record<string, string>): never {
  redirect(`${path}?${new URLSearchParams(params).toString()}`);
}

/** Runs a change; an AdminError goes back to the page as ?error=... */
async function attempt(path: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof AdminError || error instanceof BillingCancelError) {
      go(path, { error: error.message });
    }
    if (error instanceof z.ZodError) go(path, { error: error.issues[0]!.message });
    throw error;
  }
}

// ---- Students --------------------------------------------------------------------------

export async function studentAction(id: string, formData: FormData): Promise<never> {
  const path = `/admin/students/${id}`;
  const a = await admin(path);
  const sql = appSql();
  const action = String(formData.get("action") ?? "");
  const now = new Date();
  if (action === "delete") {
    if (formData.get("confirm") !== "DELETE") go(path, { error: "Type DELETE to confirm." });
    await attempt(path, async () => {
      await deleteStudentData(id, a.id);
      await audit(sql, a, "student.deleted", "student", id);
    });
    go("/admin/students", { done: "Student and their data deleted." });
  }
  await attempt(path, async () => {
    if (action === "pause")
      await pauseStudent(sql, a, id, String(formData.get("reason") ?? ""), now);
    else if (action === "resume") await resumeStudent(sql, a, id);
    else if (action === "class")
      await changeClass(sql, a, id, String(formData.get("class") ?? ""), now);
    else if (action === "merge") {
      const duplicate = String(formData.get("duplicate") ?? "");
      if (!z.uuid().safeParse(duplicate).success) throw new AdminError("Choose the duplicate.");
      await mergeStudents(sql, a, id, duplicate);
    } else throw new AdminError("Choose what to do.");
  });
  go(path, { done: action });
}

// ---- Payments --------------------------------------------------------------------------

export async function recordManualPaymentAction(formData: FormData): Promise<never> {
  const path = "/admin/payments";
  const a = await admin(path);
  const major = Number(formData.get("amount"));
  const parsed = ManualPaymentSchema.safeParse({
    target: { kind: "student", studentId: formData.get("studentId") },
    planId: formData.get("planId"),
    currency: formData.get("currency"),
    amountMinor: Number.isFinite(major) ? Math.round(major * 100) : NaN,
    paidAt: formData.get("paidAt"),
    periodStart: formData.get("periodStart"),
    periodEnd: formData.get("periodEnd"),
    bankReference: formData.get("bankReference"),
    note: String(formData.get("note") ?? "") || undefined,
  });
  if (!parsed.success) go(path, { error: parsed.error.issues[0]!.message });
  const result = await recordManualPayment(getBillingStore(), parsed.data!, a.id);
  go(path, {
    done:
      result === "duplicate" ? "That bank reference was already recorded." : "Payment recorded.",
  });
}

// ---- Pilot console ---------------------------------------------------------------------

export async function preparePilotAction(job: ManualJob): Promise<never> {
  const path = "/admin/pilot";
  const a = await admin(path);
  const sql = appSql();
  const report = await prepareManual(job, {
    sql,
    now: new Date(),
    dryRun: false,
    appUrl: serverEnv("app").NEXT_PUBLIC_APP_URL,
    practiceSecret: serverEnv("practice").PRACTICE_LINK_SECRET,
  });
  const made = report.planned.filter((p) => p.queued).length;
  await audit(sql, a, "pilot.prepared", "outbound_queue", null, { job, made });
  go(path, { done: `${made} new message${made === 1 ? "" : "s"} ready to send.` });
}

export async function markSentAction(id: number): Promise<never> {
  const path = "/admin/pilot";
  const a = await admin(path);
  await attempt(path, () => markSent(appSql(), a, id, new Date()));
  go(path, { sent: String(id) });
}

// ---- Ambassadors -----------------------------------------------------------------------

export async function saveAmbassadorAction(id: string | null, formData: FormData): Promise<never> {
  const path = "/admin/ambassadors";
  const a = await admin(path);
  const parsed = AmbassadorInputSchema.safeParse({
    name: String(formData.get("name") ?? ""),
    code: String(formData.get("code") ?? ""),
    email: String(formData.get("email") ?? ""),
    payoutCountry: formData.get("payoutCountry"),
    payoutMethod: formData.get("payoutMethod"),
    active: formData.get("active") === "on",
  });
  if (!parsed.success) go(path, { error: parsed.error.issues[0]!.message });
  await attempt(path, () => saveAmbassador(appSql(), a, parsed.data!, id ?? undefined));
  go(path, { done: `Saved ${parsed.data!.code}.` });
}

export async function paystackRecipientAction(id: string, formData: FormData): Promise<never> {
  const path = "/admin/ambassadors";
  const a = await admin(path);
  const sql = appSql();
  const accountNumber = String(formData.get("accountNumber") ?? "").replace(/\D/g, "");
  const bankCode = String(formData.get("bankCode") ?? "").trim();
  if (!/^\d{10}$/.test(accountNumber))
    go(path, { error: "Nigerian account numbers have 10 digits." });
  if (!/^\d{3,6}$/.test(bankCode)) go(path, { error: "Enter the bank's Paystack code, e.g. 058." });
  const [amb] = await sql.query<{ name: string }>(
    "select name from public.ambassadors where id = $1",
    [id],
  );
  if (!amb) go(path, { error: "That ambassador doesn't exist." });
  try {
    const recipient = await createPaystackRecipient({ name: amb!.name, accountNumber, bankCode });
    await setPayoutDestination(sql, a, id, { kind: "paystack", ...recipient });
  } catch (error) {
    go(path, { error: error instanceof Error ? error.message : "Paystack refused the account." });
  }
  go(path, { done: "Bank account registered with Paystack." });
}

export async function stripeOnboardingAction(id: string): Promise<never> {
  const path = "/admin/ambassadors";
  const a = await admin(path);
  const sql = appSql();
  const [amb] = await sql.query<{ email: string | null; stripe_account_id: string | null }>(
    "select email, stripe_account_id from public.ambassadors where id = $1",
    [id],
  );
  if (!amb) go(path, { error: "That ambassador doesn't exist." });
  let url: string;
  try {
    const onboarding = await stripeOnboarding({
      accountId: amb!.stripe_account_id,
      email: amb!.email,
      returnUrl: `${serverEnv("app").NEXT_PUBLIC_APP_URL}/admin/ambassadors`,
    });
    if (!amb!.stripe_account_id) {
      await setPayoutDestination(sql, a, id, {
        kind: "stripe_connect",
        accountId: onboarding.accountId,
      });
    }
    url = onboarding.url;
  } catch (error) {
    go(path, { error: error instanceof Error ? error.message : "Stripe refused." });
  }
  // Send this link to the ambassador: they finish their Stripe Express account themselves.
  go(path, { onboarding: url!, for: id });
}

export async function prepareBatchAction(formData: FormData): Promise<never> {
  const path = "/admin/ambassadors";
  const a = await admin(path);
  const month = String(formData.get("month") ?? "");
  let batchId = "";
  await attempt(path, async () => {
    batchId = await prepareBatch(appSql(), a, month);
  });
  redirect(`/admin/ambassadors/batches/${batchId}`);
}

export async function batchAction(id: string, formData: FormData): Promise<never> {
  const path = `/admin/ambassadors/batches/${id}`;
  const a = await admin(path);
  const sql = appSql();
  const action = String(formData.get("action") ?? "");
  if (action === "discard") {
    await attempt(path, () => discardBatch(sql, a, id));
    go("/admin/ambassadors", { done: "Batch discarded." });
  }
  if (action === "confirm") {
    if (formData.get("checked") !== "on")
      go(path, { error: "Tick that you've checked the amounts." });
    let summary = "";
    await attempt(path, async () => {
      const r = await confirmBatch(sql, a, id, payoutClients());
      summary = `${r.paid} paid, ${r.sending} waiting for Paystack approval, ${r.manual} to pay by hand, ${r.failed} failed.`;
    });
    go(path, { done: summary });
  }
  if (action === "mark-paid") {
    await attempt(path, () =>
      markPayoutPaid(
        sql,
        a,
        String(formData.get("payoutId") ?? ""),
        String(formData.get("reference") ?? ""),
      ),
    );
    go(path, { done: "Marked as paid." });
  }
  go(path, { error: "Choose what to do." });
}

// ---- AI explanations -----------------------------------------------------------------

export async function flagExplanationAction(id: string, formData: FormData): Promise<never> {
  const path = "/admin/ai";
  const a = await admin(path);
  await attempt(path, () =>
    flagExplanation(appSql(), a, id, String(formData.get("reason") ?? ""), new Date()),
  );
  go(path, { done: "Flagged: it won't be shown again; the next request makes a new one." });
}

// ---- Settings --------------------------------------------------------------------------

export async function saveSettingsAction(formData: FormData): Promise<never> {
  const path = "/admin/settings";
  const a = await admin(path);
  const prices: Record<string, Record<string, string>> = {};
  for (const [key, value] of formData.entries()) {
    const match = /^price:(\w+):(\w+)$/.exec(key);
    if (match) (prices[match[1]!] ??= {})[match[2]!] = String(value);
  }
  const parsed = SettingsInputSchema.safeParse({
    questionsPerDay: formData.get("questionsPerDay"),
    reminderEnabled: formData.get("reminderEnabled") === "on",
    streakThreshold: formData.get("streakThreshold"),
    graceDays: formData.get("graceDays"),
    waPerSecond: formData.get("waPerSecond"),
    waPerDay: formData.get("waPerDay"),
    aiPerDay: formData.get("aiPerDay"),
    prices,
  });
  if (!parsed.success) go(path, { error: parsed.error.issues[0]!.message });
  await attempt(path, () => saveSettings(appSql(), a, parsed.data!));
  go(path, { done: "Settings saved." });
}
