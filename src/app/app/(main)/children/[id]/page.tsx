import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccessBadge } from "@/components/access-badge";
import { AccuracyChart } from "@/components/accuracy-chart";
import { SessionList, Stat, WeakTopics, WeekDots } from "@/components/progress";
import { ButtonLink, Card, Notice, styles } from "@/components/ui";
import { requirePayer } from "@/lib/auth";
import {
  answerHistory,
  getChild,
  openMissedDaysAlert,
  pendingConsentRequest,
} from "@/lib/data/children";
import { streakThreshold } from "@/lib/data/settings";
import { childAccess } from "@/lib/data/status";
import { EXAM_LABELS } from "@/lib/labels";
import { todayPracticeUrl } from "@/lib/practice/server";
import { lagosDay, weekStart } from "@/lib/rules/days";
import {
  currentStreak,
  recentSessions,
  weakestTopics,
  weekDots,
  weeklyAccuracy,
} from "@/lib/rules/progress";
import { isSeniorBirthYear } from "@/lib/rules/students";
import { sendEncouragement } from "./actions";

export const metadata: Metadata = { title: "Progress" };

const NOTES: Record<string, { tone: "good" | "warn"; text: string }> = {
  sent: { tone: "good", text: "Sent. They'll see it next time they start practising." },
  full: {
    tone: "warn",
    text: "Three messages are already waiting for them. Try again after they've practised.",
  },
  invalid: { tone: "warn", text: "Write a message of up to 160 characters." },
};

export default async function ChildDashboard({
  params,
  searchParams,
}: PageProps<"/app/children/[id]">) {
  const { user, payer } = await requirePayer();
  const { id } = await params;
  const query = await searchParams;
  const child = await getChild(id);
  if (!child) notFound();
  const isOwner = child.owner_id === user.id;

  const now = new Date();
  const today = lagosDay(now);
  const [answers, status, pendingConsent, threshold] = await Promise.all([
    answerHistory(id, now),
    childAccess(id, now),
    isOwner ? pendingConsentRequest(id) : Promise.resolve(null),
    streakThreshold(),
  ]);
  const missed = await openMissedDaysAlert(id, answers);
  const thisWeek = answers.filter((a) => weekStart(lagosDay(a.answeredAt)) === weekStart(today));
  const eightWeeks = weeklyAccuracy(answers, today);
  const recent = answers.filter((a) => lagosDay(a.answeredAt) >= eightWeeks[0]!.weekStart);
  const note = typeof query.note === "string" ? NOTES[query.note] : undefined;
  const senior = isSeniorBirthYear(child.birth_year, now);
  // Today's web practice link (signed, 24 hours): how a junior's daily link reaches the parent's
  // phone, and a fallback for seniors when WhatsApp isn't working.
  const practiceUrl =
    isOwner && status.access.state !== "inactive" && !status.access.awaitingConsent
      ? todayPracticeUrl(id, now)
      : null;
  const daysToExam = child.exam_date
    ? Math.ceil(
        (Date.parse(`${child.exam_date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) /
          86_400_000,
      )
    : null;

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-3xl font-bold text-navy-dark">
          {child.first_name} {child.last_initial}.
        </h1>
        <p className="text-navy-dark/80">
          {child.class} · {EXAM_LABELS[child.exam]}
          {daysToExam !== null && daysToExam >= 0 && ` · ${daysToExam} days to go`}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <AccessBadge {...status} timeZone={payer.timezone} />
          {isOwner && status.access.state !== "active" && !status.access.awaitingConsent && (
            <Link href={`/app/children/${id}/plan`} className={styles.link}>
              Choose a plan
            </Link>
          )}
        </div>
      </header>

      {query.paid === "1" && (
        <Notice tone="good">Payment received. Thank you! It can take a minute to show here.</Notice>
      )}
      {status.access.awaitingConsent && isOwner && (
        <Notice tone="warn">
          {child.first_name} can start once their parent or guardian agrees.{" "}
          <Link href={`/app/children/${id}/consent`} className={styles.link}>
            {pendingConsent ? "Send the link again" : "Ask them now"}
          </Link>
        </Notice>
      )}
      {missed && (
        <Notice tone="warn">
          {child.first_name} hasn&apos;t practised for {missed.days} days in a row.{" "}
          <Link href="#encourage" className={styles.link}>
            Send some encouragement
          </Link>
        </Notice>
      )}
      {!senior && (
        <Notice>
          Junior mode: {child.first_name} practises on a web page you open for them on your phone.
          We never message children under 13 on WhatsApp.
        </Notice>
      )}

      {practiceUrl && (
        <Card>
          <h2 className="font-semibold text-navy-dark">Today&apos;s practice</h2>
          <p className={`${styles.hint} mt-1`}>
            {senior
              ? `If WhatsApp isn't working, ${child.first_name} can do today's questions on the web instead.`
              : `Open it on your phone and hand it to ${child.first_name}. The link works for 24 hours.`}
          </p>
          {/* A plain link, not next/link: the page is a tiny HTML route, not part of the app. */}
          <a
            href={practiceUrl}
            className={`${senior ? styles.secondaryButton : styles.primaryButton} mt-3 w-full`}
          >
            {senior ? "Practise on the web" : `Open ${child.first_name}'s practice`}
          </a>
        </Card>
      )}

      <Card>
        <h2 className="mb-3 font-semibold text-navy-dark">This week</h2>
        <WeekDots dots={weekDots(answers, today, threshold)} threshold={threshold} />
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Stat value={currentStreak(answers, today, threshold)} label="day streak" />
          <Stat value={thisWeek.length} label="questions this week" />
        </div>
      </Card>

      <Card>
        <AccuracyChart
          title="Accuracy, last 8 weeks"
          points={eightWeeks.map((w) => ({
            label: new Date(`${w.weekStart}T12:00:00Z`).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
              timeZone: "UTC",
            }),
            accuracy: w.accuracy,
            answered: w.answered,
          }))}
        />
      </Card>

      <Card>
        <h2 className="mb-3 font-semibold text-navy-dark">Topics to work on</h2>
        <WeakTopics topics={weakestTopics(recent)} />
      </Card>

      <Card id="encourage">
        <h2 className="font-semibold text-navy-dark">Send encouragement</h2>
        <p className={`${styles.hint} mt-1`}>
          KinPrep shows it to {child.first_name} next time they start practising.
        </p>
        {note && (
          <div className="mt-3">
            <Notice tone={note.tone}>{note.text}</Notice>
          </div>
        )}
        <form action={sendEncouragement.bind(null, id)} className="mt-3 flex flex-col gap-3">
          <textarea
            name="message"
            required
            maxLength={160}
            rows={2}
            placeholder={`Well done this week, ${child.first_name}! Keep going.`}
            className={styles.input}
            aria-label="Your message"
          />
          <button type="submit" className={styles.secondaryButton}>
            Send
          </button>
        </form>
      </Card>

      <Card>
        <h2 className="mb-2 font-semibold text-navy-dark">Last 10 sessions</h2>
        <SessionList sessions={recentSessions(answers)} timeZone={payer.timezone} />
      </Card>

      <div className="flex flex-col gap-3">
        <ButtonLink href={`/app/children/${id}/report`} variant="secondary">
          Weekly report
        </ButtonLink>
        {isOwner && (
          <Link href="/app/settings" className={`${styles.link} text-center`}>
            Billing, sharing and data
          </Link>
        )}
      </div>
    </div>
  );
}
