import Link from "next/link";
import { Card, Notice, styles } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { bankHealth, LOW_TOPIC_THRESHOLD } from "@/lib/bank/service";
import { appSql } from "@/lib/db/postgres";
import { SUBJECT_LABELS } from "@/lib/labels";
import { draftAction, reviewAction } from "./actions";

const LETTERS = ["A", "B", "C", "D", "E"];

export default async function BankHealthPage({ searchParams }: PageProps<"/admin/questions">) {
  await requireStaff("/admin/questions");
  const query = await searchParams;
  const health = await bankHealth(appSql(), new Date());
  const error = typeof query.error === "string" ? query.error : null;

  return (
    <div className="flex flex-col gap-6">
      {error && <Notice tone="warn">{error}</Notice>}
      {query.done === "flag" && <Notice tone="good">Flagged for re-checking.</Notice>}

      <section aria-labelledby="runway">
        <h2 id="runway" className="mb-2 text-lg font-bold text-navy-dark">
          Runway per subject
        </h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {health.subjects.map((s) => (
            <Card key={s.subject}>
              <p className="font-semibold text-navy-dark">{SUBJECT_LABELS[s.subject]}</p>
              <p className={`text-3xl font-bold ${s.runway < 14 ? "text-red-700" : "text-navy"}`}>
                {s.runway} {s.runway === 1 ? "day" : "days"}
              </p>
              <p className={styles.hint}>
                of fresh questions for an average active student · {s.approved} approved
              </p>
            </Card>
          ))}
        </div>
      </section>

      <section aria-labelledby="topics">
        <h2 id="topics" className="mb-2 text-lg font-bold text-navy-dark">
          Approved questions per topic
        </h2>
        <p className={`${styles.hint} mb-2`}>
          Topics with fewer than {LOW_TOPIC_THRESHOLD} approved questions are in red.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-navy-dark/70">
              <tr>
                <th className="py-2 pr-3">Subject</th>
                <th className="py-2 pr-3">Topic</th>
                <th className="py-2 pr-3">Approved</th>
                <th className="py-2 pr-3">Waiting review</th>
                <th className="py-2 pr-3">Flagged</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {health.topics.map((t) => (
                <tr key={t.id} className={`border-t border-navy/10 ${t.low ? "bg-red-50" : ""}`}>
                  <td className="py-2 pr-3">{SUBJECT_LABELS[t.subject]}</td>
                  <td className="py-2 pr-3">
                    <Link href={`/admin/questions/bank?topic=${t.id}`} className={styles.link}>
                      {t.name}
                    </Link>
                  </td>
                  <td className={`py-2 pr-3 font-bold ${t.low ? "text-red-700" : ""}`}>
                    {t.approved}
                  </td>
                  <td className="py-2 pr-3">{t.waiting}</td>
                  <td className="py-2 pr-3">{t.flagged}</td>
                  <td className="py-2">
                    <form action={draftAction.bind(null, t.id)}>
                      <button className="text-sm font-semibold text-navy underline">
                        Draft 10 questions with AI
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="shortages">
        <h2 id="shortages" className="mb-2 text-lg font-bold text-navy-dark">
          Bank shortages (last 14 days)
        </h2>
        {health.shortages.length === 0 ? (
          <p className={styles.hint}>No student has run out of fresh questions.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {health.shortages.map((s) => (
              <li key={`${s.subject}-${s.topic}`}>
                <strong>
                  {SUBJECT_LABELS[s.subject]}: {s.topic}
                </strong>{" "}
                ran out for {s.students} {s.students === 1 ? "student" : "students"} on {s.days}{" "}
                {s.days === 1 ? "day" : "days"} (last {s.last_day})
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="recheck">
        <h2 id="recheck" className="mb-2 text-lg font-bold text-navy-dark">
          Unusually low correct rates: check these again
        </h2>
        {health.recheck.length === 0 ? (
          <p className={styles.hint}>No approved question stands out.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {health.recheck.map((q) => (
              <li key={q.id}>
                <Card className="flex flex-col gap-2">
                  <p className="font-semibold">{q.stem}</p>
                  <p className="text-sm text-navy-dark/80">
                    {SUBJECT_LABELS[q.subject]}: {q.topic} · {q.rate}% right from {q.attempts}{" "}
                    answers
                    {q.topicRate !== null && ` (rest of the topic: ${q.topicRate}%)`}
                    {q.popularWrong &&
                      ` · most chose ${LETTERS[q.popularWrong.index]} (${q.popularWrong.share}%): is the answer key right?`}
                  </p>
                  <div className="flex flex-wrap gap-3">
                    <Link href={`/admin/questions/${q.id}`} className={styles.link}>
                      Edit
                    </Link>
                    {q.flagged ? (
                      <span className="text-sm font-semibold text-red-700">
                        Flagged: waiting in the review queue
                      </span>
                    ) : (
                      <form action={reviewAction.bind(null, q.id)}>
                        <input type="hidden" name="action" value="flag" />
                        <input type="hidden" name="returnTo" value="/admin/questions" />
                        <input
                          type="hidden"
                          name="reason"
                          value={`Only ${q.rate}% right${q.topicRate !== null ? ` (topic ${q.topicRate}%)` : ""}`}
                        />
                        <button className="text-sm font-semibold text-navy underline">
                          Flag for re-checking (stops it being sent)
                        </button>
                      </form>
                    )}
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
