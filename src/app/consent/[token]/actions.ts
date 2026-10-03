"use server";

import { redirect } from "next/navigation";
import { withinLimit } from "@/lib/security/server";
import { acceptConsentRequest } from "@/lib/services/students";

export async function acceptConsent(token: string, formData: FormData): Promise<never> {
  if (formData.get("agree") !== "on") redirect(`/consent/${token}?error=tick`);
  if (!(await withinLimit("consent"))) redirect(`/consent/${token}?error=rate`);
  const accepted = await acceptConsentRequest(token);
  if (!accepted) redirect(`/consent/${token}`);
  redirect(`/consent/${token}?done=1`);
}
