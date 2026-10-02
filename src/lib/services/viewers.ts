import "server-only";
import { adminDb } from "@/lib/db/admin";
import { hashToken, isTokenShape } from "@/lib/tokens";

export type ViewerInvite = {
  inviteId: string;
  studentId: string;
  firstName: string;
  ownerId: string;
};

export async function findViewerInvite(token: string): Promise<ViewerInvite | null> {
  if (!isTokenShape(token)) return null;
  const { data, error } = await adminDb()
    .from("viewer_invites")
    .select("id, student_id, students!inner(first_name, owner_id)")
    .eq("token_hash", hashToken(token))
    .is("accepted_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const student = data.students as unknown as { first_name: string; owner_id: string };
  return {
    inviteId: data.id as string,
    studentId: data.student_id as string,
    firstName: student.first_name,
    ownerId: student.owner_id,
  };
}

/** Adds the user as a read-only co-sponsor. Returns the student id, or null if the link is dead. */
export async function acceptViewerInvite(token: string, userId: string): Promise<string | null> {
  const invite = await findViewerInvite(token);
  if (!invite) return null;
  if (invite.ownerId === userId) return invite.studentId;
  const db = adminDb();
  const { data, error } = await db
    .from("viewer_invites")
    .update({ accepted_at: new Date().toISOString(), accepted_by: userId })
    .eq("id", invite.inviteId)
    .is("accepted_at", null)
    .select("id");
  if (error) throw new Error(error.message);
  if (data.length === 0) return null; // someone else used it first
  const { error: insertError } = await db
    .from("student_viewers")
    .upsert(
      { student_id: invite.studentId, viewer_id: userId, invited_by: invite.ownerId },
      { ignoreDuplicates: true },
    );
  if (insertError) throw new Error(insertError.message);
  return invite.studentId;
}
