import { STREAK_DAY_THRESHOLD, type Subject } from "@/config/pilot";
import { isStudentActive } from "@/lib/access";
import type { Sql } from "@/lib/db/sql";
import { accessStore, questionsPerDay } from "@/lib/practice/repo";
import { lagosDay, lagosDayStart, type Day } from "@/lib/rules/days";
import { nextReview, updateMastery, type Mastery } from "./mastery";
import { runwayDays } from "./runway";
import { planDailySet, type DailySetPlan } from "./select";

// The practice engine, shared by the WhatsApp bot and the web page: choosing the day's set,
// recording what each answer changes, and how long the question bank lasts. The decisions are
// pure functions (select.ts, mastery.ts, runway.ts, and the streak in rules/progress.ts); this
// file reads their inputs and saves their results. The session flow (start, answer, next,
// summary) is in session.ts.

export { currentStreak, weekDots } from "@/lib/rules/progress";
export type { DailySetPlan, Pick, PickReason, Shortage } from "./select";

const toDay = (value: Date | string | null): Day | null =>
  value === null ? null : lagosDay(new Date(value));

/**
 * The student's set for `day`: N approved questions (N = the questions-per-day setting; never a
 * draft, a rejected question or one flagged for re-checking) in their
 * subjects and class, mixed as described in select.ts. If the bank can't fill it, the set is
 * topped up with review questions and a bank_shortage event is logged per empty topic.
 */
export async function buildDailySet(
  sql: Sql,
  studentId: string,
  day: Day,
  options: { size?: number } = {},
): Promise<DailySetPlan> {
  const [student] = await sql.query<{ class: string; subjects: Subject[] }>(
    "select class::text, subjects::text[] as subjects from public.students where id = $1",
    [studentId],
  );
  if (!student) throw new Error(`Student ${studentId} not found`);
  const size = options.size ?? (await questionsPerDay(sql));
  const rows = await sql.query<{
    id: string;
    subject: Subject;
    topic_id: string;
    last_answered_at: Date | null;
    last_correct_at: Date | null;
    next_review_at: Date | null;
  }>(
    `select q.id::text, q.subject::text, q.topic_id::text,
            max(a.answered_at) as last_answered_at,
            max(a.answered_at) filter (where a.correct) as last_correct_at,
            r.next_review_at
     from public.questions q
     left join public.answers a on a.question_id = q.id and a.student_id = $1
     left join public.question_reviews r on r.question_id = q.id and r.student_id = $1
     where q.status = 'approved' and q.flagged_at is null
       and q.subject::text = any($2::text[])
       and $3::public.student_class = any(q.classes)
     group by q.id, r.next_review_at`,
    [studentId, student.subjects, student.class],
  );
  const mastery = await sql.query<{ topic_id: string; attempts: number; accuracy: number }>(
    "select topic_id::text, attempts, accuracy::float8 as accuracy from public.topic_mastery where student_id = $1",
    [studentId],
  );
  const plan = planDailySet({
    day,
    size,
    candidates: rows.map((r) => ({
      id: r.id,
      subject: r.subject,
      topicId: r.topic_id,
      lastAnsweredDay: toDay(r.last_answered_at),
      lastCorrectDay: toDay(r.last_correct_at),
      nextReviewDay: toDay(r.next_review_at),
    })),
    mastery: mastery.map((m) => ({
      topicId: m.topic_id,
      attempts: m.attempts,
      accuracy: Number(m.accuracy),
    })),
  });
  for (const s of plan.shortages) {
    await sql.query(
      `insert into public.engine_events (kind, student_id, subject, topic_id, lagos_day, details)
       values ('bank_shortage', $1, $2, $3, $4, $5::jsonb)
       on conflict do nothing`,
      [
        studentId,
        s.subject,
        s.topicId,
        day,
        JSON.stringify({
          set_size: size,
          picked: plan.picks.length,
          topped_up: plan.picks.filter((p) => p.reason === "topup").length,
        }),
      ],
    );
  }
  return plan;
}

/**
 * Records what one answer changes: the topic's weighted rolling accuracy and, for spaced review,
 * when the question comes back. Call it once per answer, in the same transaction that saves it.
 */
export async function recordAttempt(
  sql: Sql,
  attempt: { studentId: string; questionId: string; correct: boolean; at: Date },
): Promise<void> {
  const [question] = await sql.query<{ topic_id: string }>(
    "select topic_id::text from public.questions where id = $1",
    [attempt.questionId],
  );
  if (!question) throw new Error(`Question ${attempt.questionId} not found`);

  const [previous] = await sql.query<Mastery>(
    `select attempts, correct, accuracy::float8 as accuracy from public.topic_mastery
     where student_id = $1 and topic_id = $2 for update`,
    [attempt.studentId, question.topic_id],
  );
  const mastery = updateMastery(
    previous ? { ...previous, accuracy: Number(previous.accuracy) } : null,
    attempt.correct,
  );
  await sql.query(
    `insert into public.topic_mastery (student_id, topic_id, attempts, correct, accuracy, last_attempt_at)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (student_id, topic_id) do update
       set attempts = excluded.attempts, correct = excluded.correct,
           accuracy = excluded.accuracy, last_attempt_at = excluded.last_attempt_at`,
    [
      attempt.studentId,
      question.topic_id,
      mastery.attempts,
      mastery.correct,
      mastery.accuracy,
      attempt.at,
    ],
  );

  const [review] = await sql.query<{ step: number; next_review_at: Date | null }>(
    `select step, next_review_at from public.question_reviews
     where student_id = $1 and question_id = $2 for update`,
    [attempt.studentId, attempt.questionId],
  );
  const previousReview = review
    ? { step: review.step, nextReviewDay: toDay(review.next_review_at) }
    : null;
  const next = nextReview(previousReview, attempt.correct, lagosDay(attempt.at));
  if (next === null || next === previousReview) return; // nothing under review, nothing to change
  await sql.query(
    `insert into public.question_reviews (student_id, question_id, step, next_review_at, updated_at)
     values ($1, $2, $3, $4, $5)
     on conflict (student_id, question_id) do update
       set step = excluded.step, next_review_at = excluded.next_review_at, updated_at = excluded.updated_at`,
    [
      attempt.studentId,
      attempt.questionId,
      next.step,
      next.nextReviewDay === null ? null : lagosDayStart(next.nextReviewDay),
      attempt.at,
    ],
  );
}

/**
 * Days of fresh questions left in a subject for an average active student, at the current
 * questions-per-day setting (see runway.ts).
 */
export async function bankRunway(
  sql: Sql,
  subject: Subject,
  now: Date = new Date(),
): Promise<number> {
  const students = await sql.query<{ id: string; fresh: number; subjects: number }>(
    `select s.id::text, cardinality(s.subjects) as subjects,
            (select count(*)::int from public.questions q
             where q.status = 'approved' and q.flagged_at is null
               and q.subject = $1::public.subject and s.class = any(q.classes)
               and not exists (select 1 from public.answers a where a.student_id = s.id and a.question_id = q.id)
            ) as fresh
     from public.students s
     where $1::public.subject = any(s.subjects)`,
    [subject],
  );
  const store = accessStore(sql);
  const active = [];
  for (const s of students) if (await isStudentActive(s.id, { now, store })) active.push(s);
  const [bank] = await sql.query<{ n: number }>(
    "select count(*)::int as n from public.questions where status = 'approved' and flagged_at is null and subject = $1::public.subject",
    [subject],
  );
  return runwayDays({
    students: active,
    bankSize: bank!.n,
    questionsPerDay: await questionsPerDay(sql),
  });
}

/** Answers that make a Lagos day count towards the streak (admin setting, default 5). */
export async function streakThreshold(sql: Sql): Promise<number> {
  const [row] = await sql.query<{ value: unknown }>(
    "select value from public.settings where key = 'streak_day_threshold'",
  );
  const n = Number(row?.value);
  return Number.isInteger(n) && n >= 1 && n <= 20 ? n : STREAK_DAY_THRESHOLD;
}
