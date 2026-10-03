"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireStaff } from "@/lib/auth";
import { DraftError } from "@/lib/bank/llm";
import { QuestionInputSchema } from "@/lib/bank/rules";
import { questionDrafter } from "@/lib/bank/server";
import {
  BankError,
  draftQuestions,
  importCsv,
  reviewQuestion,
  saveQuestion,
  saveTopic,
  staffMember,
  TopicInputSchema,
  type Decision,
} from "@/lib/bank/service";
import { appSql } from "@/lib/db/postgres";
import type { ImportError } from "@/lib/bank/rules";

const BASE = "/admin/questions";

async function staff() {
  const user = await requireStaff(BASE);
  return staffMember(appSql(), user.id);
}

const back = (path: string, params: Record<string, string>) =>
  `${path}?${new URLSearchParams(params).toString()}`;

export type EditorState = { error?: string };

/**
 * The editor's form. The five option boxes may have gaps; the right answer is the ticked box,
 * counted among the filled ones.
 */
export async function saveQuestionAction(
  id: string | null,
  _previous: EditorState,
  formData: FormData,
): Promise<EditorState> {
  const member = await staff();
  const raw = formData.getAll("option").map(String);
  const ticked = Number(formData.get("answerIndex") ?? -1);
  const answerIndex = raw[ticked]?.trim()
    ? raw.slice(0, ticked).filter((o) => o.trim()).length
    : -1;
  const parsed = QuestionInputSchema.safeParse({
    topicId: formData.get("topicId"),
    stem: String(formData.get("stem") ?? ""),
    options: raw,
    answerIndex,
    explanationEn: String(formData.get("explanationEn") ?? ""),
    explanationPcm: String(formData.get("explanationPcm") ?? ""),
    classes: formData.getAll("classes").map(String),
    syllabusRef: String(formData.get("syllabusRef") ?? ""),
    originalConfirmed: formData.get("originalConfirmed") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };
  const mode = z.enum(["draft", "review", "approve"]).catch("draft").parse(formData.get("mode"));
  let saved: string;
  try {
    saved = await saveQuestion(appSql(), member, parsed.data, {
      id: id ?? undefined,
      mode,
      checks: {
        answer: formData.get("answerChecked") === "on",
        explanation: formData.get("explanationChecked") === "on",
      },
    });
  } catch (error) {
    if (error instanceof BankError) return { error: error.message };
    throw error;
  }
  redirect(back(`${BASE}/${saved}`, { saved: mode }));
}

/** Approve, reject, flag, clear or retire, from the review queue or the bank page. */
export async function reviewAction(id: string, formData: FormData): Promise<never> {
  const member = await staff();
  const returnTo = String(formData.get("returnTo") ?? `${BASE}/review`);
  const safeReturn = returnTo.startsWith(BASE) ? returnTo : `${BASE}/review`;
  const action = String(formData.get("action") ?? "");
  const reason = String(formData.get("reason") ?? "");
  const decision: Decision | null =
    action === "approve"
      ? {
          action,
          answerChecked: formData.get("answerChecked") === "on",
          explanationChecked: formData.get("explanationChecked") === "on",
          originalConfirmed: formData.get("originalConfirmed") === "on",
        }
      : action === "reject" || action === "flag" || action === "retire"
        ? { action, reason }
        : action === "clear"
          ? { action }
          : null;
  if (!decision) redirect(back(safeReturn, { error: "Choose what to do." }));
  try {
    await reviewQuestion(appSql(), member, id, decision);
  } catch (error) {
    if (error instanceof BankError) {
      redirect(`${back(safeReturn, { error: error.message, q: id })}#q-${id}`);
    }
    throw error;
  }
  redirect(back(safeReturn, { done: action }));
}

/** "Draft 10 questions for this topic". */
export async function draftAction(topicId: string): Promise<never> {
  const member = await staff();
  const drafter = questionDrafter();
  if (!drafter) {
    redirect(back(BASE, { error: "AI drafting isn't set up yet: add LLM_API_KEY and LLM_MODEL." }));
  }
  let created = 0;
  try {
    created = (await draftQuestions(appSql(), member, drafter, topicId)).created;
  } catch (error) {
    if (error instanceof BankError || error instanceof DraftError) {
      redirect(back(BASE, { error: error.message }));
    }
    throw error;
  }
  redirect(back(`${BASE}/review`, { drafted: String(created) }));
}

export async function saveTopicAction(id: string | null, formData: FormData): Promise<never> {
  const member = await staff();
  const parsed = TopicInputSchema.safeParse({
    subject: formData.get("subject"),
    name: String(formData.get("name") ?? ""),
    jambRef: String(formData.get("jambRef") ?? ""),
    waecRef: String(formData.get("waecRef") ?? ""),
  });
  if (!parsed.success) {
    redirect(back(`${BASE}/syllabus`, { error: parsed.error.issues[0]!.message }));
  }
  try {
    await saveTopic(appSql(), member, parsed.data, id ?? undefined);
  } catch (error) {
    if (error instanceof BankError) redirect(back(`${BASE}/syllabus`, { error: error.message }));
    throw error;
  }
  redirect(back(`${BASE}/syllabus`, { saved: parsed.data.name }));
}

export type ImportState = { created?: number; errors?: ImportError[]; error?: string };

const MAX_IMPORT_BYTES = 2_000_000;

export async function importAction(
  _previous: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const member = await staff();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a CSV file." };
  if (file.size > MAX_IMPORT_BYTES) return { error: "That file is over 2 MB. Split it up." };
  return importCsv(appSql(), member, await file.text());
}
