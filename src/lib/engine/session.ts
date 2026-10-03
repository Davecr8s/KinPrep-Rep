import type { Sql } from "@/lib/db/sql";
import { addDays, lagosDay, lagosDayStart, weekStart } from "@/lib/rules/days";
import { buildDailySet, recordAttempt, streakThreshold } from "./index";
import {
  currentStreak,
  weakestTopics,
  weekDots,
  type TopicAccuracy,
  type WeekDot,
} from "@/lib/rules/progress";
import {
  answerHistory,
  createSession,
  getQuestion,
  league,
  SESSION_COLUMNS,
  todaySession,
  type Channel,
  type LeagueRow,
  type PracticeStudent,
  type Question,
  type Session,
} from "@/lib/practice/repo";

// The session flow, shared by every channel (WhatsApp bot, web practice page) so a set, its
// marking and its summary are the same wherever the student practises. Every state change
// names the position it applies to, so a double tap, a resent request after a dropped
// connection or an old WhatsApp button is a harmless no-op.

export type StartResult =
  { kind: "started" | "resumed"; session: Session } | { kind: "noQuestions" };

/** Today's set on this channel, built by buildDailySet if there isn't one yet. */
export async function startOrResumeSet(
  sql: Sql,
  student: PracticeStudent,
  channel: Channel,
  day: string,
  now: Date,
): Promise<StartResult> {
  const existing = await todaySession(sql, student.id, channel, day);
  if (existing) return { kind: "resumed", session: existing };
  const plan = await buildDailySet(sql, student.id, day);
  if (plan.picks.length === 0) return { kind: "noQuestions" };
  return {
    kind: "started",
    session: await createSession(sql, student.id, channel, day, plan.picks, now),
  };
}

export type MarkResult =
  | { kind: "marked"; question: Question; chosen: number; correct: boolean }
  | { kind: "invalidOption"; question: Question }
  /** That question isn't the one waiting for an answer (already answered, or set moved on). */
  | { kind: "stale" };

/** Marks the answer to the question at `position` and records it, exactly once. */
export async function markAnswer(
  sql: Sql,
  input: { session: Session; studentId: string; position: number; option: number; now: Date },
): Promise<MarkResult> {
  const questionId = input.session.question_ids[input.position];
  if (questionId === undefined) return { kind: "stale" };
  const question = await getQuestion(sql, questionId);
  if (
    !Number.isInteger(input.option) ||
    input.option < 0 ||
    input.option >= question.options.length
  ) {
    return { kind: "invalidOption", question };
  }
  const correct = input.option === question.answer_index;
  const claimed = await sql.transaction(async (tx) => {
    const rows = await tx.query(
      `update public.practice_sessions set awaiting = 'next'
       where id = $1 and position = $2 and awaiting = 'answer' and completed_at is null
       returning id`,
      [input.session.id, input.position],
    );
    if (rows.length === 0) return false;
    await tx.query(
      `insert into public.answers (session_id, student_id, question_id, chosen_index, correct, answered_at)
       values ($1, $2, $3, $4, $5, $6) on conflict (session_id, question_id) do nothing`,
      [input.session.id, input.studentId, question.id, input.option, correct, input.now],
    );
    await recordAttempt(tx, {
      studentId: input.studentId,
      questionId: question.id,
      correct,
      at: input.now,
    });
    return true;
  });
  return claimed ? { kind: "marked", question, chosen: input.option, correct } : { kind: "stale" };
}

export type AdvanceResult =
  | { kind: "question"; session: Session }
  | { kind: "finished"; session: Session }
  | { kind: "stale" };

/** Moves on from the answered question at `position`: the next question, or the set is done. */
export async function advanceSet(
  sql: Sql,
  session: Session,
  position: number,
  now: Date,
): Promise<AdvanceResult> {
  const last = position >= session.question_ids.length - 1;
  const [row] = await sql.query<Session>(
    last
      ? `update public.practice_sessions set completed_at = $3, ended_at = $3
         where id = $1 and position = $2 and awaiting = 'next' and completed_at is null
         returning ${SESSION_COLUMNS}`
      : `update public.practice_sessions set position = position + 1, awaiting = 'answer'
         where id = $1 and position = $2 and awaiting = 'next' and completed_at is null
         returning ${SESSION_COLUMNS}`,
    last ? [session.id, position, now] : [session.id, position],
  );
  if (!row) return { kind: "stale" };
  return { kind: last ? "finished" : "question", session: row };
}

/** The teacher-written explanation in the student's language (English if there's no Pidgin). */
export function explanationFor(question: Question, language: "en" | "pcm"): string {
  return language === "pcm"
    ? (question.explanation_pcm ?? question.explanation_en)
    : question.explanation_en;
}

export type SetSummary = {
  correct: number;
  answered: number;
  streak: number;
  week: WeekDot[];
  /** Tomorrow's focus: the weakest topic of the last four weeks, if there's enough to tell. */
  focus: TopicAccuracy | undefined;
};

export async function setSummary(
  sql: Sql,
  studentId: string,
  sessionId: string,
  day: string,
): Promise<SetSummary> {
  const history = await answerHistory(sql, studentId, lagosDayStart(addDays(day, -120)));
  const set = history.filter((a) => a.sessionId === sessionId);
  const threshold = await streakThreshold(sql);
  return {
    correct: set.filter((a) => a.correct).length,
    answered: set.length,
    streak: currentStreak(history, day, threshold),
    week: weekDots(history, day, threshold),
    focus: weakestTopics(
      history.filter((a) => lagosDay(a.answeredAt) >= addDays(day, -28)),
      { minAttempts: 2, limit: 1 },
    )[0],
  };
}

export type League = { scope: string; rows: LeagueRow[] };

/** This week's league, or null for a junior outside a group (no leagues with strangers). */
export async function leagueFor(
  sql: Sql,
  student: PracticeStudent,
  day: string,
): Promise<League | null> {
  if (student.junior && !student.group_account_id) return null;
  const rows = await league(sql, student.id, lagosDayStart(weekStart(day)));
  return { scope: student.group_account_id ? "your group" : `${student.class} students`, rows };
}
