"use server";

import { reportError } from "@/lib/monitoring/report";
import { redirect, unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { requireOwnedStudent, requirePayer } from "@/lib/auth";
import { adminDb } from "@/lib/db/admin";
import { serverEnv } from "@/lib/env";
import { getPaymentProvider } from "@/lib/payments/server";
import { assignSeat, newGroupInvite, requireOwnedGroup } from "@/lib/services/groups";
import { GroupSchema, SeatsSchema } from "@/lib/validation/forms";

export async function createGroup(formData: FormData): Promise<never> {
  const { user } = await requirePayer();
  const parsed = GroupSchema.safeParse({ name: formData.get("name"), kind: formData.get("kind") });
  if (!parsed.success) redirect("/app/groups?error=group");
  const { error } = await adminDb()
    .from("group_accounts")
    .insert({ owner_id: user.id, ...parsed.data! });
  if (error) throw new Error(error.message);
  redirect("/app/groups");
}

export async function buySeats(groupId: string, formData: FormData): Promise<never> {
  const { user } = await requirePayer();
  await requireOwnedGroup(groupId, user.id);
  const parsed = SeatsSchema.safeParse({ seats: formData.get("seats") });
  if (!parsed.success) redirect("/app/groups?error=seats#seats");
  const appUrl = serverEnv("app").NEXT_PUBLIC_APP_URL;
  let url: string;
  try {
    const result = await getPaymentProvider("stripe").createCheckout({
      target: { kind: "group", groupAccountId: groupId, seats: parsed.data!.seats },
      planId: "bulk_seat_monthly",
      currency: "GBP",
      payerEmail: user.email ?? undefined,
      payerId: user.id,
      trial: false,
      successUrl: `${appUrl}/app/groups?paid=1`,
      cancelUrl: `${appUrl}/app/groups`,
    });
    if (result.kind !== "redirect") throw new Error("Expected a redirect");
    url = result.url;
  } catch (error) {
    unstable_rethrow(error);
    await reportError({ where: "action:groups", error });
    redirect("/app/groups?error=checkout#seats");
  }
  redirect(url);
}

export async function makeInviteLink(groupId: string): Promise<never> {
  const { user } = await requirePayer();
  await requireOwnedGroup(groupId, user.id);
  const token = await newGroupInvite(groupId, user.id);
  redirect(`/app/groups?invite=${token}#invite`);
}

export async function giveSeat(studentId: string): Promise<never> {
  await requireOwnedStudent(studentId);
  const { data } = await adminDb()
    .from("students")
    .select("group_account_id")
    .eq("id", studentId)
    .single();
  const groupId = z.uuid().safeParse(data?.group_account_id);
  if (!groupId.success) redirect("/app/groups");
  const ok = await assignSeat(groupId.data, studentId);
  redirect(ok ? "/app/groups#students" : "/app/groups?error=full#students");
}
