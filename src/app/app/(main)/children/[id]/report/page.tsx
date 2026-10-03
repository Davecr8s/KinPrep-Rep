import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Stat, WeakTopics } from "@/components/progress";
import { Card, styles } from "@/components/ui";
import { requirePayer } from "@/lib/auth";
import { answerHistory, getChild } from "@/lib/data/children";
import { streakThreshold } from "@/lib/data/settings";
import { SUBJECT_LABELS } from "@/lib/labels";
import { addDays, lagosDay, weekStart } from "@/lib/rules/days";
import { reportHeadline, reportText, weeklyReport } from "@/lib/rules/progress";

export const metadata: Metadata = { title: "Weekly report" };

const long = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });

export default async function WeeklyReportPage({
  params,
  searchParams,
}: PageProps<"/app/children/[id]/report">) {
  await requirePayer();
  const { id } = await params;
  const query = await searchParams;
  const child = await getChild(id);
  if (!child) notFound();

  const now = new Date();
  const thisWeek = weekStart(lagosDay(now));
  const lastFullWeek = addDays(thisWeek, -7);
  const requested =
    typeof query.week === "string" && /^\d{4}-\d{2}-\d{2}$/.test(query.week)
      ? weekStart(query.week)
      : lastFullWeek;
  const monday = requested > thisWeek ? thisWeek : requested;
  // Reach back far enough for the streak as it stood on that Sunday.
  const answers = await answerHistory(id, now, addDays(monday, -120));
  const report = weeklyReport(answers, monday, await streakThreshold());
  const inProgress = monday === thisWeek;

  return (
    <div className="flex flex-col gap-5">
      <header>
        <p className="text-navy-dark/70">
          <Link href={`/app/children/${id}`} className={styles.link}>
            {child.first_name}
          </Link>{" "}
          · Weekly report
        </p>
        <h1 className="mt-1 text-2xl font-bold text-navy-dark">
          {long(report.weekStart)} to {long(report.weekEnd)}
          {inProgress && <span className="font-normal text-navy-dark/70"> (so far)</span>}
        </h1>
      </header>

      <nav className="flex justify-between" aria-label="Weeks">
        <Link href={`?week=${addDays(monday, -7)}`} className={styles.link}>
          ‹ Previous week
        </Link>
        {!inProgress && (
          <Link href={`?week=${addDays(monday, 7)}`} className={styles.link}>
            Next week ›
          </Link>
        )}
      </nav>

      <Card>
        <p className="text-lg font-semibold text-navy-dark">
          {reportHeadline(report, child.first_name)}
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Stat value={`${report.daysPractised}/7`} label="days practised" />
          <Stat value={report.answered} label="questions answered" />
          <Stat value={report.accuracy === null ? "–" : `${report.accuracy}%`} label="correct" />
          <Stat value={report.streak} label="day streak" />
        </div>
      </Card>

      <Card>
        <h2 className="mb-2 font-semibold text-navy-dark">By subject</h2>
        {report.bySubject.length === 0 ? (
          <p className="text-navy-dark/70">No questions answered this week.</p>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="text-sm text-navy-dark/70">
                <th className="py-1 font-semibold">Subject</th>
                <th className="py-1 text-right font-semibold">Answered</th>
                <th className="py-1 text-right font-semibold">Correct</th>
              </tr>
            </thead>
            <tbody>
              {report.bySubject.map((s) => (
                <tr key={s.subject} className="border-t border-navy/10">
                  <td className="py-2">{SUBJECT_LABELS[s.subject]}</td>
                  <td className="py-2 text-right">{s.answered}</td>
                  <td className="py-2 text-right font-semibold">{s.accuracy}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 font-semibold text-navy-dark">Topics to work on</h2>
        <WeakTopics topics={report.weakestTopics} />
      </Card>

      <details className="rounded-2xl border border-navy/10 p-4">
        <summary className="cursor-pointer font-semibold text-navy">As sent on WhatsApp</summary>
        <pre className="mt-3 font-sans text-sm whitespace-pre-wrap text-navy-dark">
          {reportText(report, child.first_name)}
        </pre>
      </details>
    </div>
  );
}
