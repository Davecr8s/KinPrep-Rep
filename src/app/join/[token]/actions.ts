"use server";

import { redirect } from "next/navigation";
import type { ChildFormState } from "@/components/child-fields";
import { assignSeat, findGroupInvite } from "@/lib/services/groups";
import { createStudent, DuplicateWhatsAppError, recordConsent } from "@/lib/services/students";
import { childSchema, fieldErrors } from "@/lib/validation/forms";

const TEXT_FIELDS = [
  "firstName",
  "lastInitial",
  "class",
  "birthYear",
  "exam",
  "examDate",
  "language",
  "whatsapp",
  "consent",
];

/** A parent adds their child to a group (church, school...) through the group's invite link. */
export async function joinGroup(
  token: string,
  _prev: ChildFormState,
  formData: FormData,
): Promise<ChildFormState> {
  const invite = await findGroupInvite(token);
  if (!invite) redirect(`/join/${token}`);
  const values: ChildFormState["values"] = Object.fromEntries(
    TEXT_FIELDS.map((k) => [k, String(formData.get(k) ?? "")]),
  );
  values.subjects = formData.getAll("subjects").map(String);

  const child = childSchema(new Date()).safeParse(values);
  const errors = child.success ? {} : fieldErrors(child.error);
  if (values.consent !== "on")
    errors.consent = "As the child's parent or guardian, tick the box to agree.";
  if (!child.success || errors.consent) return { values, errors };

  let studentId: string;
  try {
    studentId = await createStudent(child.data, {
      ownerId: invite!.ownerId,
      groupId: invite!.groupId,
    });
  } catch (error) {
    if (error instanceof DuplicateWhatsAppError) {
      return { values, errors: { whatsapp: "This number is already used by another student." } };
    }
    throw error;
  }
  // The person filling this in declares they are the guardian; there's no account to link.
  await recordConsent(studentId, { givenBy: null, method: "web_checkbox" });
  const seated = await assignSeat(invite!.groupId, studentId);
  redirect(
    `/join/${token}?joined=${encodeURIComponent(child.data.firstName)}${seated ? "" : "&noseat=1"}`,
  );
}
