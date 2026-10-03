import type { Metadata } from "next";
import Link from "next/link";
import { Card, Notice, styles } from "@/components/ui";
import { SUBJECTS } from "@/config/pilot";
import { requireStaff } from "@/lib/auth";
import { listTopics } from "@/lib/bank/service";
import { appSql } from "@/lib/db/postgres";
import { SUBJECT_LABELS } from "@/lib/labels";
import { draftAction, saveTopicAction } from "../actions";

export const metadata: Metadata = { title: "Syllabus" };

// Subjects and topics, each mapped to the published JAMB (UTME) and WAEC (WASSCE) syllabus.
// Admins edit; reviewers see the mapping while they write and review.
export default async function SyllabusPage({
  searchParams,
}: PageProps<"/admin/questions/syllabus">) {
  const staff = await requireStaff("/admin/questions/syllabus");
  const query = await searchParams;
  const topics = await listTopics(appSql());
  const admin = staff.role === "admin";
  const error = typeof query.error === "string" ? query.error : null;
  const saved = typeof query.saved === "string" ? query.saved : null;
  const grid = "grid gap-2 md:grid-cols-[1fr_1.5fr_1.5fr_auto]";

  return (
    <div className="flex flex-col gap-6">
      {error && <Notice tone="warn">{error}</Notice>}
      {saved && <Notice tone="good">Saved “{saved}”.</Notice>}
      {SUBJECTS.map((subject) => (
        <section key={subject} aria-labelledby={`s-${subject}`}>
          <h2 id={`s-${subject}`} className="mb-2 text-lg font-bold text-navy-dark">
            {SUBJECT_LABELS[subject]}
          </h2>
          <ul className="flex flex-col gap-2">
            {topics
              .filter((t) => t.subject === subject)
              .map((t) => (
                <li key={t.id}>
                  <Card>
                    {admin ? (
                      <form action={saveTopicAction.bind(null, t.id)} className={grid}>
                        <input type="hidden" name="subject" value={subject} />
                        <input
                          name="name"
                          defaultValue={t.name}
                          aria-label="Topic"
                          className={styles.input}
                        />
                        <input
                          name="jambRef"
                          defaultValue={t.jamb_ref ?? ""}
                          placeholder="JAMB syllabus reference"
                          aria-label="JAMB syllabus reference"
                          className={styles.input}
                        />
                        <input
                          name="waecRef"
                          defaultValue={t.waec_ref ?? ""}
                          placeholder="WAEC syllabus reference"
                          aria-label="WAEC syllabus reference"
                          className={styles.input}
                        />
                        <button className={styles.secondaryButton}>Save</button>
                      </form>
                    ) : (
                      <div>
                        <p className="font-semibold">{t.name}</p>
                        <p className="text-sm text-navy-dark/80">
                          JAMB: {t.jamb_ref ?? "not mapped"} · WAEC: {t.waec_ref ?? "not mapped"}
                        </p>
                      </div>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-4 text-sm">
                      <span className={t.approved < 10 ? "font-bold text-red-700" : ""}>
                        {t.approved} approved
                      </span>
                      <Link href={`/admin/questions/new?topic=${t.id}`} className={styles.link}>
                        Write a question
                      </Link>
                      <form action={draftAction.bind(null, t.id)}>
                        <button className="font-semibold text-navy underline">
                          Draft 10 questions with AI
                        </button>
                      </form>
                    </div>
                  </Card>
                </li>
              ))}
          </ul>
          {admin && (
            <form action={saveTopicAction.bind(null, null)} className={`mt-2 ${grid}`}>
              <input type="hidden" name="subject" value={subject} />
              <input
                name="name"
                required
                placeholder="New topic"
                aria-label={`New ${SUBJECT_LABELS[subject]} topic`}
                className={styles.input}
              />
              <input
                name="jambRef"
                placeholder="JAMB syllabus reference"
                aria-label="JAMB syllabus reference"
                className={styles.input}
              />
              <input
                name="waecRef"
                placeholder="WAEC syllabus reference"
                aria-label="WAEC syllabus reference"
                className={styles.input}
              />
              <button className={styles.primaryButton}>Add topic</button>
            </form>
          )}
        </section>
      ))}
    </div>
  );
}
