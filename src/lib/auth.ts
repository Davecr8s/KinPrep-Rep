import "server-only";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { z } from "zod";
import { adminDb } from "@/lib/db/admin";
import { userDb } from "@/lib/supabase/server";

export type SignedInUser = { id: string; email: string | null };

/** The signed-in user, verified from the session (cached per request). */
export const currentUser = cache(async (): Promise<SignedInUser | null> => {
  const db = await userDb();
  const { data } = await db.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;
  return { id: claims.sub, email: typeof claims.email === "string" ? claims.email : null };
});

export async function requireUser(): Promise<SignedInUser> {
  const user = await currentUser();
  if (!user) redirect("/app/sign-in");
  return user;
}

const PayerSchema = z.object({
  id: z.string(),
  region: z.enum(["abroad", "nigeria"]),
  currency: z.enum(["GBP", "USD", "CAD", "NGN"]),
  timezone: z.string(),
  payer_type: z.enum(["sponsor", "parent", "group"]),
  whatsapp_number: z.string().nullable(),
  whatsapp_reports_opt_in_at: z.string().nullable(),
  report_weekday: z.number().int(),
  report_hour: z.number().int(),
});
export type Payer = z.infer<typeof PayerSchema>;

export const currentPayer = cache(async (): Promise<Payer | null> => {
  const user = await currentUser();
  if (!user) return null;
  const db = await userDb();
  const { data, error } = await db
    .from("payers")
    .select(
      "id, region, currency, timezone, payer_type, whatsapp_number, whatsapp_reports_opt_in_at, report_weekday, report_hour",
    )
    .eq("id", user.id)
    .maybeSingle();
  if (error) throw new Error(`Loading payer failed: ${error.message}`);
  return data ? PayerSchema.parse(data) : null;
});

/** A signed-in user who has finished onboarding; otherwise redirects to the right step. */
export async function requirePayer(): Promise<{ user: SignedInUser; payer: Payer }> {
  const user = await requireUser();
  const payer = await currentPayer();
  if (!payer) redirect("/app/onboarding");
  return { user, payer };
}

/**
 * For server actions that change a child: the student must be managed by the signed-in payer.
 * Viewers (co-sponsors) can look but not change. Returns the student's first name.
 */
export async function requireOwnedStudent(
  studentId: string,
): Promise<{ user: SignedInUser; payer: Payer; firstName: string }> {
  const { user, payer } = await requirePayer();
  if (!z.uuid().safeParse(studentId).success) notFound();
  const { data, error } = await adminDb()
    .from("students")
    .select("owner_id, first_name")
    .eq("id", studentId)
    .maybeSingle();
  if (error) throw new Error(`Loading student failed: ${error.message}`);
  if (!data || data.owner_id !== user.id) notFound();
  return { user, payer, firstName: data.first_name as string };
}
