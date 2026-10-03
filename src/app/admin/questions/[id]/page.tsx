import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Notice } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { getBankQuestion, listTopics } from "@/lib/bank/service";
import { appSql } from "@/lib/db/postgres";
import { saveQuestionAction } from "../actions";
import { QuestionEditor } from "../question-editor";

export const metadata: Metadata = { title: "Edit question" };

const SAVED: Record<string, string> = {
  approve: "Saved and approved: it can now be sent to students.",
  review: "Saved and sent for review.",
  draft: "Draft saved.",
};
const STATUS: Record<string, string> = {
  draft: "a draft",
  in_review: "waiting for review",
  approved: "approved",
  rejected: "rejected",
  retired: "retired",
};

export default async function EditQuestionPage({
  params,
  searchParams,
}: PageProps<"/admin/questions/[id]">) {
  const { id } = await params;
  await requireStaff(`/admin/questions/${id}`);
  const query = await searchParams;
  const sql = appSql();
  const [question, topics] = await Promise.all([getBankQuestion(sql, id), listTopics(sql)]);
  if (!question) notFound();
  const saved = typeof query.saved === "string" ? SAVED[query.saved] : undefined;
  return (
    <div className="flex flex-col gap-4">
      {saved && <Notice tone="good">{saved}</Notice>}
      <p className="text-sm text-navy-dark/70">
        This question is {STATUS[question.status]}
        {question.flagged_at ? `, flagged for re-checking (${question.flag_reason})` : ""}
        {question.rejection_reason ? `: ${question.rejection_reason}` : ""}.
        {question.status === "approved" &&
          " Saving it as a draft or for review takes it out of students' sets."}
      </p>
      <QuestionEditor
        topics={topics}
        initial={{
          topicId: question.topic_id,
          stem: question.stem,
          options: question.options,
          answerIndex: question.answer_index,
          explanationEn: question.explanation_en,
          explanationPcm: question.explanation_pcm ?? "",
          classes: question.classes,
          syllabusRef: question.syllabus_ref ?? "",
          originalConfirmed: question.original_confirmed,
          source: question.source,
          status: question.status,
        }}
        action={saveQuestionAction.bind(null, question.id)}
      />
    </div>
  );
}
