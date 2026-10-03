import type { Metadata } from "next";
import Link from "next/link";
import { styles } from "@/components/ui";
import { SUBJECTS } from "@/config/pilot";
import { requireStaff } from "@/lib/auth";
import { listQuestions, listTopics } from "@/lib/bank/service";
import { appSql } from "@/lib/db/postgres";
import { SUBJECT_LABELS } from "@/lib/labels";
import { draftAction } from "../actions";

export const metadata: Metadata = { title: "Questions" };

const STATUSES = ["draft", "in_review", "approved", "rejected", "retired"] as const;
const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  in_review: "In review",
  approved: "Approved",
  rejected: "Rejected",
  retired: "Retired",
};

export default async function QuestionsPage({ searchParams }: PageProps<"/admin/questions/bank">) {
  await requireStaff("/admin/questions/bank");
  const query = await searchParams;
  const pick = (k: string, allowed?: readonly string[]) => {
    const v = query[k];
    return typeof v === "string" && v && (!allowed || allowed.includes(v)) ? v : undefined;
  };
  const sql = appSql();
  const topics = await listTopics(sql);
  const topicId = pick(
    "topic",
    topics.map((t) => t.id),
  );
  const filter = { status: pick("status", STATUSES), subject: pick("subject", SUBJECTS), topicId };
  const questions = await listQuestions(sql, filter);
  const topic = topics.find((t) => t.id === topicId);

  return (
    <div className="flex flex-col gap-4">
      <form className="flex flex-wrap items-end gap-3" action="/admin/questions/bank">
        <label className="flex flex-col gap-1">
          <span className={styles.label}>Subject</span>
          <select name="subject" defaultValue={filter.subject ?? ""} className={styles.input}>
            <option value="">All</option>
            {SUBJECTS.map((s) => (
              <option key={s} value={s}>
                {SUBJECT_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={styles.label}>Topic</span>
          <select name="topic" defaultValue={topicId ?? ""} className={styles.input}>
            <option value="">All</option>
            {topics.map((t) => (
              <option key={t.id} value={t.id}>
                {SUBJECT_LABELS[t.subject]}: {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={styles.label}>Status</span>
          <select name="status" defaultValue={filter.status ?? ""} className={styles.input}>
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <button className={styles.secondaryButton}>Show</button>
      </form>

      {topic && (
        <form
          action={draftAction.bind(null, topic.id)}
          className="flex flex-wrap items-center gap-3"
        >
          <button className={styles.primaryButton}>Draft 10 questions for {topic.name}</button>
          <span className={styles.hint}>
            AI drafts are saved for review and never sent to students until approved.
          </span>
        </form>
      )}

      <p className="text-sm text-navy-dark/70">
        {questions.length} question{questions.length === 1 ? "" : "s"}
        {questions.length === 200 && " (the newest 200; narrow the filter to see more)"}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-navy-dark/70">
            <tr>
              <th className="py-2 pr-3">Question</th>
              <th className="py-2 pr-3">Topic</th>
              <th className="py-2 pr-3">Status</th>
              <th className="py-2 pr-3">Source</th>
              <th className="py-2">Reviewed by</th>
            </tr>
          </thead>
          <tbody>
            {questions.map((q) => (
              <tr key={q.id} className="border-t border-navy/10 align-top">
                <td className="py-2 pr-3">
                  <Link href={`/admin/questions/${q.id}`} className={styles.link}>
                    {q.stem.length > 90 ? `${q.stem.slice(0, 89)}…` : q.stem}
                  </Link>
                </td>
                <td className="py-2 pr-3">
                  {SUBJECT_LABELS[q.subject]}: {q.topic}
                </td>
                <td className="py-2 pr-3">
                  {STATUS_LABELS[q.status]}
                  {q.flagged_at && <span className="block text-red-700">Flagged</span>}
                  {q.rejection_reason && (
                    <span className="block text-navy-dark/70">{q.rejection_reason}</span>
                  )}
                </td>
                <td className="py-2 pr-3">{q.source.replace("_", " ")}</td>
                <td className="py-2">{q.reviewer_email ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
