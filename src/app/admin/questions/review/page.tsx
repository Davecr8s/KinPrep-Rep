import type { Metadata } from "next";
import Link from "next/link";
import { Card, Notice, styles } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { reviewQueue } from "@/lib/bank/service";
import { appSql } from "@/lib/db/postgres";
import { SUBJECT_LABELS } from "@/lib/labels";
import { reviewAction } from "../actions";

export const metadata: Metadata = { title: "Review queue" };

const LETTERS = ["A", "B", "C", "D", "E"];
const SOURCE_LABELS = { ai_draft: "AI draft", import: "Imported", human: "Written by a teacher" };
const DONE: Record<string, string> = {
  approve: "Approved: it can now be sent to students.",
  reject: "Rejected.",
  clear: "Flag cleared: it can be sent again.",
  retire: "Retired: it won't be sent again.",
};

export default async function ReviewQueuePage({
  searchParams,
}: PageProps<"/admin/questions/review">) {
  await requireStaff("/admin/questions/review");
  const query = await searchParams;
  const queue = await reviewQueue(appSql());
  const error = typeof query.error === "string" ? query.error : null;
  const done = typeof query.done === "string" ? DONE[query.done] : undefined;

  return (
    <div className="flex flex-col gap-4">
      {typeof query.drafted === "string" && (
        <Notice tone="good">
          {query.drafted} AI drafts added below. Check each answer and explanation before approving.
        </Notice>
      )}
      {done && <Notice tone="good">{done}</Notice>}
      {error && !query.q && <Notice tone="warn">{error}</Notice>}
      <p className="text-navy-dark/80">
        {queue.length === 0
          ? "Nothing waiting for review."
          : `${queue.length} waiting: flagged questions first, then the oldest.`}
      </p>
      <ul className="flex flex-col gap-4">
        {queue.map((q) => {
          const ai = q.source === "ai_draft";
          return (
            <li key={q.id} id={`q-${q.id}`}>
              <Card className="flex flex-col gap-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm text-navy-dark/70">
                    {SUBJECT_LABELS[q.subject]}: {q.topic} · {q.classes.join(", ")}
                  </p>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-bold ${ai ? "bg-orange-light text-navy-dark" : "bg-navy/10 text-navy"}`}
                  >
                    {q.flagged_at ? "Flagged" : SOURCE_LABELS[q.source]}
                  </span>
                </div>
                {q.flagged_at && (
                  <Notice tone="warn">
                    Flagged for re-checking: {q.flag_reason}. It isn&apos;t sent to students until
                    cleared or fixed.
                  </Notice>
                )}
                {error && query.q === q.id && <Notice tone="warn">{error}</Notice>}
                <p className="text-lg font-semibold">{q.stem}</p>
                <ol className="flex flex-col gap-1">
                  {q.options.map((o, i) => (
                    <li
                      key={i}
                      className={`rounded-lg px-3 py-2 ${i === q.answer_index ? "bg-green-50 font-semibold text-green-800" : "bg-navy/5"}`}
                    >
                      {LETTERS[i]}) {o} {i === q.answer_index && "✓ marked as the answer"}
                    </li>
                  ))}
                </ol>
                <div className="grid gap-2 md:grid-cols-2">
                  <div>
                    <p className="text-sm font-semibold">Explanation (English)</p>
                    <p className="whitespace-pre-wrap">{q.explanation_en}</p>
                  </div>
                  <div>
                    <p className="text-sm font-semibold">Explanation (Pidgin)</p>
                    <p className="whitespace-pre-wrap">
                      {q.explanation_pcm ?? <span className="text-red-700">Missing</span>}
                    </p>
                  </div>
                </div>

                {q.flagged_at ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <form action={reviewAction.bind(null, q.id)}>
                      <input type="hidden" name="action" value="clear" />
                      <button className={styles.secondaryButton}>
                        It&apos;s right: clear the flag
                      </button>
                    </form>
                    <Link href={`/admin/questions/${q.id}`} className={styles.secondaryButton}>
                      Edit and approve
                    </Link>
                    <form action={reviewAction.bind(null, q.id)} className="flex gap-2">
                      <input type="hidden" name="action" value="retire" />
                      <input
                        name="reason"
                        required
                        minLength={3}
                        placeholder="Why retire it?"
                        className={styles.input}
                      />
                      <button className={styles.dangerButton}>Retire</button>
                    </form>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3 border-t border-navy/10 pt-3">
                    <form action={reviewAction.bind(null, q.id)} className="flex flex-col gap-2">
                      <input type="hidden" name="action" value="approve" />
                      <label className="flex gap-3">
                        <input
                          type="checkbox"
                          name="originalConfirmed"
                          required
                          defaultChecked={q.original_confirmed}
                          className="mt-1 size-5 shrink-0 accent-navy"
                        />
                        <span>Original question, not from a past paper</span>
                      </label>
                      {ai && (
                        <>
                          <label className="flex gap-3">
                            <input
                              type="checkbox"
                              name="answerChecked"
                              required
                              className="mt-1 size-5 shrink-0 accent-navy"
                            />
                            <span>
                              I have checked the answer ({LETTERS[q.answer_index]}) is right
                            </span>
                          </label>
                          <label className="flex gap-3">
                            <input
                              type="checkbox"
                              name="explanationChecked"
                              required
                              className="mt-1 size-5 shrink-0 accent-navy"
                            />
                            <span>I have checked both explanations</span>
                          </label>
                        </>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <button className={styles.primaryButton}>Approve</button>
                        <Link href={`/admin/questions/${q.id}`} className={styles.secondaryButton}>
                          Edit and approve
                        </Link>
                      </div>
                    </form>
                    <form action={reviewAction.bind(null, q.id)} className="flex flex-wrap gap-2">
                      <input type="hidden" name="action" value="reject" />
                      <input
                        name="reason"
                        required
                        minLength={3}
                        maxLength={500}
                        placeholder="Reason for rejecting (e.g. two options are right)"
                        className={`${styles.input} min-w-64 flex-1`}
                      />
                      <button className={styles.dangerButton}>Reject</button>
                    </form>
                  </div>
                )}
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
