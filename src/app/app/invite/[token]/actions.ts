"use server";

import { redirect } from "next/navigation";
import { requirePayer } from "@/lib/auth";
import { acceptViewerInvite } from "@/lib/services/viewers";

export async function acceptInvite(token: string): Promise<never> {
  const { user } = await requirePayer();
  const studentId = await acceptViewerInvite(token, user.id);
  redirect(studentId ? `/app/children/${studentId}` : `/app/invite/${token}?gone=1`);
}
