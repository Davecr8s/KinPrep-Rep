"use server";

import { redirect } from "next/navigation";
import { requireOwnedStudent } from "@/lib/auth";
import { createConsentRequest } from "@/lib/services/students";

/** A new guardian link (the old one stops working). */
export async function newConsentLink(studentId: string): Promise<never> {
  const { user } = await requireOwnedStudent(studentId);
  const token = await createConsentRequest(studentId, user.id);
  redirect(`/app/children/${studentId}/consent?link=${token}`);
}
