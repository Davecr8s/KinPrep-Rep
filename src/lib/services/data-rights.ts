import "server-only";
import { appSql } from "@/lib/db/postgres";
import { toSubscriptionRecord, SUBSCRIPTION_COLUMNS } from "@/lib/payments/rows";
import { getPaymentProvider } from "@/lib/payments/server";
import { adminDb } from "@/lib/db/admin";
import {
  deleteStudent,
  exportStudent,
  renewingSubscriptions,
  type StudentExport,
} from "@/lib/privacy/data-rights";

// Export and deletion of a student's data (NDPA 2023, UK GDPR; CLAUDE.md), for the payer app and
// /admin. Callers have checked that the signed-in user manages the student. The rules (what is
// exported and deleted) are in src/lib/privacy/data-rights.ts.

export class BillingCancelError extends Error {}

/** Everything KinPrep holds about one student, as plain JSON. */
export async function exportStudentData(
  studentId: string,
  requestedBy: string,
): Promise<StudentExport> {
  const data = await exportStudent(appSql(), studentId, requestedBy, new Date());
  if (!data) throw new Error("Student not found");
  return data;
}

/**
 * Deletes a student and everything attached to them. Renewing subscriptions are cancelled at the
 * provider first, immediately, so nobody is charged for a deleted student.
 */
export async function deleteStudentData(studentId: string, requestedBy: string): Promise<void> {
  const sql = appSql();
  for (const { id, provider } of await renewingSubscriptions(sql, studentId)) {
    const { data, error } = await adminDb()
      .from("subscriptions")
      .select(SUBSCRIPTION_COLUMNS)
      .eq("id", id)
      .single();
    if (error) throw new Error(error.message);
    try {
      await getPaymentProvider(provider).cancel(toSubscriptionRecord(data), { immediately: true });
    } catch (cause) {
      throw new BillingCancelError(`Could not cancel ${provider} subscription ${id}`, { cause });
    }
  }
  await deleteStudent(sql, studentId, requestedBy, new Date());
}
