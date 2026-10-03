"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { productionExplainer } from "@/lib/ai/server";
import { requireAdmin } from "@/lib/auth";
import { appSql } from "@/lib/db/postgres";
import { serverEnv } from "@/lib/env";
import { normalizePhone } from "@/lib/phone";
import { resetNumber, simulateInbound, type SimulatedInput } from "@/lib/whatsapp/simulator";

const PAGE = "/admin/dev/whatsapp";

function phoneOrBack(raw: string): string {
  const phone = normalizePhone(raw, "NG");
  if (!phone) redirect(`${PAGE}?error=phone`);
  return phone;
}

async function run(phone: string, input: Omit<SimulatedInput, "phone">): Promise<never> {
  await requireAdmin(PAGE);
  await simulateInbound(
    appSql(),
    { appUrl: serverEnv("app").NEXT_PUBLIC_APP_URL, explainAnotherWay: productionExplainer() },
    { phone, ...input },
  );
  redirect(`${PAGE}?phone=${encodeURIComponent(phone)}#end`);
}

export async function simulateText(formData: FormData): Promise<never> {
  const phone = phoneOrBack(String(formData.get("phone") ?? ""));
  const text = z.string().trim().min(1).max(500).safeParse(formData.get("text"));
  if (!text.success) redirect(`${PAGE}?phone=${encodeURIComponent(phone)}`);
  return run(phone, { text: text.data });
}

export async function simulateTap(
  phone: string,
  id: string,
  title: string,
  kind: "button" | "list",
): Promise<never> {
  return run(phoneOrBack(phone), {
    reply: { id: id.slice(0, 256), title: title.slice(0, 24), kind },
  });
}

export async function resetSimulatedNumber(phone: string): Promise<never> {
  await requireAdmin(PAGE);
  if (process.env.VERCEL_ENV === "production")
    redirect(`${PAGE}?phone=${encodeURIComponent(phone)}&error=prod`);
  await resetNumber(appSql(), phoneOrBack(phone));
  redirect(`${PAGE}?phone=${encodeURIComponent(phone)}`);
}
