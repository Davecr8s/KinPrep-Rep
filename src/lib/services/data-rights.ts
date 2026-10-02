import "server-only";
import { adminDb } from "@/lib/db/admin";
import { toSubscriptionRecord, SUBSCRIPTION_COLUMNS } from "@/lib/payments/rows";
import { getPaymentProvider } from "@/lib/payments/server";

// Export and deletion of a student's data (NDPA 2023, UK GDPR; CLAUDE.md). Callers have checked
// that the signed-in user manages the student.

export class BillingCancelError extends Error {}

/** Everything KinPrep holds about one student, as plain JSON. */
export async function exportStudentData(studentId: string, requestedBy: string) {
  const db = adminDb();
  const one = async (table: string, columns = "*") => {
    const { data, error } = await db.from(table).select(columns).eq("student_id", studentId);
    if (error) throw new Error(`${table}: ${error.message}`);
    return data;
  };
  const { data: student, error } = await db
    .from("students")
    .select("*")
    .eq("id", studentId)
    .single();
  if (error) throw new Error(error.message);
  const subscriptions = await one(
    "subscriptions",
    "id, provider, plan, currency, status, current_period_end, trial_end, created_at",
  );
  const subscriptionIds = (subscriptions as unknown as { id: string }[]).map((s) => s.id);
  const { data: payments, error: payError } = subscriptionIds.length
    ? await db
        .from("payments")
        .select(
          "provider, status, amount_minor, currency, occurred_at, period_start, period_end, channel",
        )
        .in("subscription_id", subscriptionIds)
    : { data: [], error: null };
  if (payError) throw new Error(payError.message);

  const exported = {
    exported_at: new Date().toISOString(),
    student,
    guardian_consents: await one(
      "guardian_consents",
      "event, method, consent_text_version, created_at",
    ),
    subscriptions,
    payments,
    practice_sessions: await one("practice_sessions", "id, channel, started_at, ended_at"),
    answers: await one("answers", "session_id, question_id, chosen_index, correct, answered_at"),
    encouragements: await one("encouragements", "message, created_at, delivered_at"),
  };
  await db.from("data_requests").insert({
    student_id: studentId,
    kind: "export",
    status: "completed",
    requested_by: requestedBy,
    completed_at: new Date().toISOString(),
  });
  return exported;
}

/**
 * Deletes a student and everything attached to them. Renewing subscriptions are cancelled at the
 * provider first, immediately, so nobody is charged for a deleted student. The payments ledger
 * keeps amounts (accounting) but loses the link to the student.
 */
export async function deleteStudentData(studentId: string, requestedBy: string): Promise<void> {
  const db = adminDb();
  const { data, error } = await db
    .from("subscriptions")
    .select(SUBSCRIPTION_COLUMNS)
    .eq("student_id", studentId)
    .in("provider", ["stripe", "paystack"])
    .neq("status", "canceled");
  if (error) throw new Error(error.message);
  for (const row of data) {
    const record = toSubscriptionRecord(row);
    if (!record.providerSubscriptionId) continue; // pay-per-period: nothing renews
    try {
      await getPaymentProvider(record.provider as "stripe" | "paystack").cancel(record, {
        immediately: true,
      });
    } catch (cause) {
      throw new BillingCancelError(
        `Could not cancel ${record.provider} subscription ${record.id}`,
        { cause },
      );
    }
  }

  const { error: requestError } = await db.from("data_requests").insert({
    student_id: studentId,
    kind: "delete",
    status: "completed",
    requested_by: requestedBy,
    completed_at: new Date().toISOString(),
  });
  if (requestError) throw new Error(requestError.message);
  const { error: deleteError } = await db.from("students").delete().eq("id", studentId);
  if (deleteError) throw new Error(deleteError.message);
}
