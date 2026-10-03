import "server-only";
import { z } from "zod";
import { SUBJECTS } from "@/config/pilot";
import { addDays, lagosDayStart, weekStart, lagosDay } from "@/lib/rules/days";
import type { AnswerRow } from "@/lib/rules/progress";
import { userDb } from "@/lib/supabase/server";

// Reads for the payer app, as the signed-in user: RLS decides which children they can see
// (their own, ones they co-sponsor, and their class for group buyers).

const ChildSchema = z.object({
  id: z.string(),
  owner_id: z.string(),
  first_name: z.string(),
  last_initial: z.string(),
  class: z.string(),
  birth_year: z.number(),
  exam: z.enum(["BECE", "WASSCE", "NECO", "UTME"]),
  exam_date: z.string().nullable(),
  subjects: z.array(z.enum(SUBJECTS)),
  language: z.enum(["en", "pcm"]),
  whatsapp_number: z.string().nullable(),
  group_account_id: z.string().nullable(),
});
export type Child = z.infer<typeof ChildSchema>;

const CHILD_COLUMNS =
  "id, owner_id, first_name, last_initial, class, birth_year, exam, exam_date, subjects, language, whatsapp_number, group_account_id";

export async function listChildren(options: { inGroup?: string } = {}): Promise<Child[]> {
  const db = await userDb();
  let query = db.from("students").select(CHILD_COLUMNS).order("created_at");
  query = options.inGroup
    ? query.eq("group_account_id", options.inGroup)
    : query.is("group_account_id", null);
  const { data, error } = await query;
  if (error) throw new Error(`Loading children failed: ${error.message}`);
  return z.array(ChildSchema).parse(data);
}

export async function getChild(id: string): Promise<Child | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const db = await userDb();
  const { data, error } = await db
    .from("students")
    .select(CHILD_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Loading child failed: ${error.message}`);
  return data ? ChildSchema.parse(data) : null;
}

const HistoryRowSchema = z.object({
  answered_at: z.string(),
  correct: z.boolean(),
  subject: z.enum(SUBJECTS),
  topic: z.string(),
  session_id: z.string(),
});

/** Answers since `fromDay` (Lagos), with subject and topic. Default: enough for 8 weeks + streak. */
export async function answerHistory(
  studentId: string,
  now: Date,
  fromDay?: string,
): Promise<AnswerRow[]> {
  const since = lagosDayStart(fromDay ?? addDays(weekStart(lagosDay(now)), -7 * 15));
  const db = await userDb();
  const { data, error } = await db.rpc("student_answer_history", {
    p_student_id: studentId,
    p_since: since.toISOString(),
  });
  if (error) throw new Error(`Loading progress failed: ${error.message}`);
  return z
    .array(HistoryRowSchema)
    .parse(data)
    .map((r) => ({
      answeredAt: new Date(r.answered_at),
      correct: r.correct,
      subject: r.subject,
      topic: r.topic,
      sessionId: r.session_id,
    }));
}

const PendingConsentSchema = z.object({ id: z.string(), expires_at: z.string() });

/** The open guardian consent request for a child, if any. */
export async function pendingConsentRequest(studentId: string) {
  const db = await userDb();
  const { data, error } = await db
    .from("consent_requests")
    .select("id, expires_at")
    .eq("student_id", studentId)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Loading consent request failed: ${error.message}`);
  return data ? PendingConsentSchema.parse(data) : null;
}

const MissedDaysSchema = z.object({ since_day: z.string(), days: z.number() });

/**
 * The latest "missed 2 days in a row" alert (written by the 21:00 job), if the child hasn't
 * practised since it started.
 */
export async function openMissedDaysAlert(
  studentId: string,
  answers: readonly AnswerRow[],
): Promise<{ sinceDay: string; days: number } | null> {
  const db = await userDb();
  const { data, error } = await db
    .from("student_alerts")
    .select("since_day, days")
    .eq("student_id", studentId)
    .eq("kind", "missed_days")
    .order("since_day", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Loading alerts failed: ${error.message}`);
  if (!data) return null;
  const alert = MissedDaysSchema.parse(data);
  const practisedSince = answers.some((a) => lagosDay(a.answeredAt) >= alert.since_day);
  return practisedSince ? null : { sinceDay: alert.since_day, days: alert.days };
}

const SubscriptionSummarySchema = z.object({
  id: z.string(),
  provider: z.enum(["stripe", "paystack", "manual", "trial"]),
  plan: z.string(),
  currency: z.string(),
  status: z.enum(["incomplete", "trialing", "active", "past_due", "canceled"]),
  current_period_end: z.string().nullable(),
  trial_end: z.string().nullable(),
  cancel_at_period_end: z.boolean(),
  provider_subscription_id: z.string().nullable(),
});
export type SubscriptionSummary = z.infer<typeof SubscriptionSummarySchema>;

/** A child's subscriptions, newest first (RLS: the managing payer only). */
export async function childSubscriptions(studentId: string): Promise<SubscriptionSummary[]> {
  const db = await userDb();
  const { data, error } = await db
    .from("subscriptions")
    .select(
      "id, provider, plan, currency, status, current_period_end, trial_end, cancel_at_period_end, provider_subscription_id",
    )
    .eq("student_id", studentId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Loading subscriptions failed: ${error.message}`);
  return z.array(SubscriptionSummarySchema).parse(data);
}
