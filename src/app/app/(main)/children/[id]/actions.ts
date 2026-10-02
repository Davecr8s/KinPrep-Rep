"use server";

import { redirect } from "next/navigation";
import { requirePayer } from "@/lib/auth";
import { getChild } from "@/lib/data/children";
import { adminDb } from "@/lib/db/admin";
import { EncouragementSchema } from "@/lib/validation/forms";

const MAX_WAITING = 3;

/** Queues a short message the bot delivers the next time the student starts practising. */
export async function sendEncouragement(studentId: string, formData: FormData): Promise<never> {
  const { user } = await requirePayer();
  // Owners and co-sponsors may send; RLS on getChild decides who can see the student.
  if (!(await getChild(studentId))) redirect("/app");
  const page = `/app/children/${studentId}`;
  const parsed = EncouragementSchema.safeParse({ message: formData.get("message") });
  if (!parsed.success) redirect(`${page}?note=invalid#encourage`);

  const db = adminDb();
  const { count, error: countError } = await db
    .from("encouragements")
    .select("id", { count: "exact", head: true })
    .eq("student_id", studentId)
    .is("delivered_at", null);
  if (countError) throw new Error(countError.message);
  if ((count ?? 0) >= MAX_WAITING) redirect(`${page}?note=full#encourage`);

  const { error } = await db.from("encouragements").insert({
    student_id: studentId,
    sender_id: user.id,
    message: parsed.data!.message,
  });
  if (error) throw new Error(error.message);
  redirect(`${page}?note=sent#encourage`);
}
