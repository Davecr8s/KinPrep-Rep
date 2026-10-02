"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { serverEnv } from "@/lib/env";
import { userDb } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/tokens";

const EmailSchema = z.object({ email: z.email().max(254) });

/** Sends the magic link (and a 6-digit code in the same email). New emails get an account. */
export async function sendMagicLink(formData: FormData): Promise<never> {
  const next = safeNextPath(formData.get("next"));
  const parsed = EmailSchema.safeParse({ email: String(formData.get("email") ?? "").trim() });
  if (!parsed.success) redirect(`/app/sign-in?error=email&next=${encodeURIComponent(next)}`);
  const email = parsed.data!.email.toLowerCase();

  const appUrl = serverEnv("app").NEXT_PUBLIC_APP_URL;
  const db = await userDb();
  const { error } = await db.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      // The email template appends &token_hash=...&type=email (see docs/BUILD_PLAN.md).
      emailRedirectTo: `${appUrl}/auth/confirm?next=${encodeURIComponent(next)}`,
    },
  });
  if (error) {
    console.error("[sign-in] signInWithOtp failed", error.message);
    redirect(
      `/app/sign-in?error=${error.status === 429 ? "rate" : "send"}&next=${encodeURIComponent(next)}`,
    );
  }
  redirect(
    `/app/sign-in/check?email=${encodeURIComponent(email)}&next=${encodeURIComponent(next)}`,
  );
}

const CodeSchema = z.object({
  email: z.email(),
  code: z.string().regex(/^\d{6,10}$/),
});

/** Signs in with the code from the email, for when the link opens in another browser. */
export async function verifyCode(formData: FormData): Promise<never> {
  const next = safeNextPath(formData.get("next"));
  const email = String(formData.get("email") ?? "");
  const parsed = CodeSchema.safeParse({
    email,
    code: String(formData.get("code") ?? "").replace(/\s/g, ""),
  });
  const back = `/app/sign-in/check?email=${encodeURIComponent(email)}&next=${encodeURIComponent(next)}&error=code`;
  if (!parsed.success) redirect(back);
  const db = await userDb();
  const { error } = await db.auth.verifyOtp({
    email: parsed.data!.email,
    token: parsed.data!.code,
    type: "email",
  });
  if (error) redirect(back);
  redirect(next);
}

export async function signOut(): Promise<never> {
  const db = await userDb();
  await db.auth.signOut();
  redirect("/");
}
