"use server";

import { redirect } from "next/navigation";
import type { ChildFormState } from "@/components/child-fields";
import { requirePayer } from "@/lib/auth";
import { getBillingStore } from "@/lib/payments/server";
import { startFreeTrial } from "@/lib/payments/trial";
import {
  createConsentRequest,
  createStudent,
  DuplicateWhatsAppError,
  recordConsent,
} from "@/lib/services/students";
import { childSchema, fieldErrors, GuardianSchema } from "@/lib/validation/forms";

const TEXT_FIELDS = [
  "firstName",
  "lastInitial",
  "class",
  "birthYear",
  "exam",
  "examDate",
  "language",
  "whatsapp",
  "isGuardian",
  "consent",
];

export async function addChild(_prev: ChildFormState, formData: FormData): Promise<ChildFormState> {
  const { user, payer } = await requirePayer();
  const values: ChildFormState["values"] = Object.fromEntries(
    TEXT_FIELDS.map((k) => [k, String(formData.get(k) ?? "")]),
  );
  values.subjects = formData.getAll("subjects").map(String);

  const child = childSchema(new Date()).safeParse(values);
  const guardian = GuardianSchema.safeParse({
    isGuardian: values.isGuardian || undefined,
    consent: values.consent || undefined,
  });
  if (!child.success || !guardian.success) {
    return {
      values,
      errors: {
        ...(child.success ? {} : fieldErrors(child.error)),
        ...(guardian.success ? {} : fieldErrors(guardian.error)),
      },
    };
  }

  let studentId: string;
  try {
    studentId = await createStudent(child.data, { ownerId: user.id });
  } catch (error) {
    if (error instanceof DuplicateWhatsAppError) {
      return { values, errors: { whatsapp: "This number is already used by another student." } };
    }
    throw error;
  }

  if (guardian.data.isGuardian === "yes") {
    await recordConsent(studentId, { givenBy: user.id, method: "web_checkbox" });
  }
  // Naira payers get KinPrep's no-card trial; sponsors abroad get theirs in Stripe Checkout.
  if (payer.region === "nigeria") await startFreeTrial(getBillingStore(), studentId);

  if (guardian.data.isGuardian === "no") {
    const token = await createConsentRequest(studentId, user.id);
    redirect(`/app/children/${studentId}/consent?link=${token}`);
  }
  redirect(`/app/children/${studentId}/plan?new=1`);
}
