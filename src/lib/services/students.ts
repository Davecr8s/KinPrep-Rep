import "server-only";
import { adminDb } from "@/lib/db/admin";
import { CONSENT_LINK_DAYS, CONSENT_TEXT_VERSION } from "@/lib/consent";
import { hashToken, isTokenShape, newToken } from "@/lib/tokens";
import type { ChildInput } from "@/lib/validation/forms";

// Writes behind the payer app's server actions (service role). Callers have already checked
// that the signed-in user may make the change.

/** Creates the student. Siblings may share a household WhatsApp number. */
export async function createStudent(
  input: ChildInput,
  owner: { ownerId: string; groupId?: string },
): Promise<string> {
  const { data, error } = await adminDb()
    .from("students")
    .insert({
      owner_id: owner.ownerId,
      group_account_id: owner.groupId ?? null,
      first_name: input.firstName,
      last_initial: input.lastInitial,
      class: input.class,
      birth_year: input.birthYear,
      exam: input.exam,
      exam_date: input.examDate,
      subjects: input.subjects,
      language: input.language,
      whatsapp_number: input.whatsapp,
      whatsapp_opt_in_at: input.dailyMessages ? new Date().toISOString() : null,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Creating student failed: ${error.message}`);
  return data.id as string;
}

export async function recordConsent(
  studentId: string,
  consent: {
    givenBy: string | null;
    method: "web_checkbox" | "guardian_link" | "group_attestation";
  },
): Promise<void> {
  const { error } = await adminDb().from("guardian_consents").insert({
    student_id: studentId,
    event: "granted",
    method: consent.method,
    consent_text_version: CONSENT_TEXT_VERSION,
    given_by: consent.givenBy,
  });
  if (error) throw new Error(`Recording consent failed: ${error.message}`);
}

/** A fresh link for the guardian; any earlier open link stops working. Returns the token. */
export async function createConsentRequest(studentId: string, createdBy: string): Promise<string> {
  const db = adminDb();
  const now = new Date();
  await db
    .from("consent_requests")
    .update({ revoked_at: now.toISOString() })
    .eq("student_id", studentId)
    .is("accepted_at", null)
    .is("revoked_at", null);
  const { token, hash } = newToken();
  const { error } = await db.from("consent_requests").insert({
    student_id: studentId,
    token_hash: hash,
    created_by: createdBy,
    expires_at: new Date(now.getTime() + CONSENT_LINK_DAYS * 86_400_000).toISOString(),
  });
  if (error) throw new Error(`Creating consent link failed: ${error.message}`);
  return token;
}

export type ConsentRequestView = {
  requestId: string;
  studentId: string;
  firstName: string;
  className: string;
};

/** The open consent request behind a link, or null if it's invalid, used, expired or replaced. */
export async function findConsentRequest(token: string): Promise<ConsentRequestView | null> {
  if (!isTokenShape(token)) return null;
  const { data, error } = await adminDb()
    .from("consent_requests")
    .select("id, student_id, students!inner(first_name, class)")
    .eq("token_hash", hashToken(token))
    .is("accepted_at", null)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error) throw new Error(`Loading consent link failed: ${error.message}`);
  if (!data) return null;
  const student = data.students as unknown as { first_name: string; class: string };
  return {
    requestId: data.id as string,
    studentId: data.student_id as string,
    firstName: student.first_name,
    className: student.class,
  };
}

export async function acceptConsentRequest(token: string): Promise<ConsentRequestView | null> {
  const request = await findConsentRequest(token);
  if (!request) return null;
  const { data, error } = await adminDb()
    .from("consent_requests")
    .update({ accepted_at: new Date().toISOString() })
    .eq("id", request.requestId)
    .is("accepted_at", null)
    .select("id");
  if (error) throw new Error(`Accepting consent failed: ${error.message}`);
  // Someone else accepted it a moment ago: consent is already on record.
  if (data.length === 0) return request;
  await recordConsent(request.studentId, { givenBy: null, method: "guardian_link" });
  return request;
}
