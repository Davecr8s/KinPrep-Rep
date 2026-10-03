import { QUESTIONS_PER_DAY, type Subject } from "@/config/pilot";
import type { Sql } from "@/lib/db/sql";
import { billingSettingsFrom } from "@/lib/payments/billing-settings";
import { newSponsorCode } from "@/lib/payments/codes";
import { toCoverage } from "@/lib/payments/rows";
import type { BillingStore } from "@/lib/payments/types";
import type { AnswerRow } from "@/lib/rules/progress";

// Database access for daily practice, shared by the WhatsApp bot and the web practice page, in
// plain SQL so tests (PGlite) and production (postgres.js) run exactly the same queries.

export type Channel = "whatsapp" | "web";

export type PracticeStudent = {
  id: string;
  first_name: string;
  last_initial: string;
  class: string;
  subjects: Subject[];
  language: "en" | "pcm";
  group_account_id: string | null;
  /** Under 13: web practice only, opened from a parent's phone; never messaged on WhatsApp. */
  junior: boolean;
};

export const STUDENT_COLUMNS = `id::text, first_name, last_initial, class::text, subjects::text[] as subjects,
  language::text, group_account_id::text, not public.is_senior_birth_year(birth_year) as junior`;

export async function practiceStudent(sql: Sql, id: string): Promise<PracticeStudent | null> {
  const [row] = await sql.query<PracticeStudent>(
    `select ${STUDENT_COLUMNS} from public.students where id = $1`,
    [id],
  );
  return row ?? null;
}

/** What isStudentActive needs, read through the same SQL connection. */
export function accessStore(
  sql: Sql,
): Required<
  Pick<BillingStore, "getCoverages" | "hasGuardianConsent" | "isPaused" | "billingSettings">
> {
  return {
    async getCoverages(studentId, at) {
      const rows = await sql.query("select * from public.student_coverages($1, $2)", [
        studentId,
        at,
      ]);
      return rows.map(toCoverage);
    },
    async hasGuardianConsent(studentId) {
      const [row] = await sql.query<{ event: string }>(
        "select event::text from public.guardian_consents where student_id = $1 order by created_at desc limit 1",
        [studentId],
      );
      return row?.event === "granted";
    },
    async isPaused(studentId) {
      const [row] = await sql.query<{ paused: boolean }>(
        "select paused_at is not null as paused from public.students where id = $1",
        [studentId],
      );
      return row?.paused ?? false;
    },
    async billingSettings() {
      return billingSettingsFrom(
        await sql.query<{ key: string; value: unknown }>(
          "select key, value from public.settings where key in ('price_overrides', 'grace_days')",
        ),
      );
    },
  };
}

export type Session = {
  id: string;
  question_ids: string[];
  position: number;
  awaiting: "answer" | "next";
  completed_at: Date | null;
};

export const SESSION_COLUMNS =
  "id::text, question_ids::text[] as question_ids, position, awaiting, completed_at";

/** Today's set on one channel. A senior who uses both channels gets a set on each. */
export async function todaySession(
  sql: Sql,
  studentId: string,
  channel: Channel,
  day: string,
): Promise<Session | null> {
  const [row] = await sql.query<Session>(
    `select ${SESSION_COLUMNS} from public.practice_sessions
     where student_id = $1 and channel = $2 and lagos_day = $3`,
    [studentId, channel, day],
  );
  return row ?? null;
}

export async function sessionById(
  sql: Sql,
  sessionId: string,
  studentId: string,
): Promise<Session | null> {
  const [row] = await sql.query<Session>(
    `select ${SESSION_COLUMNS} from public.practice_sessions where id = $1 and student_id = $2`,
    [sessionId, studentId],
  );
  return row ?? null;
}

export async function createSession(
  sql: Sql,
  studentId: string,
  channel: Channel,
  day: string,
  set: readonly { questionId: string; reason: string }[],
  at: Date,
): Promise<Session> {
  await sql.query(
    `insert into public.practice_sessions (student_id, channel, started_at, lagos_day, question_ids, pick_reasons)
     values ($1, $2, $3, $4, $5::uuid[], $6::text[])
     on conflict do nothing`,
    [studentId, channel, at, day, set.map((p) => p.questionId), set.map((p) => p.reason)],
  );
  return (await todaySession(sql, studentId, channel, day))!;
}

export async function questionsPerDay(sql: Sql): Promise<number> {
  const [row] = await sql.query<{ value: unknown }>(
    "select value from public.settings where key = 'questions_per_day'",
  );
  const n = Number(row?.value);
  return Number.isInteger(n) && n >= 1
    ? Math.min(n, QUESTIONS_PER_DAY.max)
    : QUESTIONS_PER_DAY.default;
}

export type Question = {
  id: string;
  stem: string;
  options: string[];
  answer_index: number;
  explanation_en: string;
  explanation_pcm: string | null;
  subject: Subject;
  topic: string;
};

export async function getQuestion(sql: Sql, id: string): Promise<Question> {
  const [row] = await sql.query<Question>(
    `select q.id::text, q.stem, q.options, q.answer_index, q.explanation_en, q.explanation_pcm,
            q.subject::text, t.name as topic
     from public.questions q join public.topics t on t.id = q.topic_id
     where q.id = $1`,
    [id],
  );
  if (!row) throw new Error(`Question ${id} not found`);
  return {
    ...row,
    options: typeof row.options === "string" ? JSON.parse(row.options) : row.options,
  };
}

/** The student's recorded answer to one question of a session, if any. */
export async function recordedAnswer(
  sql: Sql,
  sessionId: string,
  questionId: string,
): Promise<{ chosen: number; correct: boolean } | null> {
  const [row] = await sql.query<{ chosen: number; correct: boolean }>(
    "select chosen_index as chosen, correct from public.answers where session_id = $1 and question_id = $2",
    [sessionId, questionId],
  );
  return row ?? null;
}

export async function answerHistory(
  sql: Sql,
  studentId: string,
  since: Date,
): Promise<AnswerRow[]> {
  const rows = await sql.query<{
    answered_at: Date;
    correct: boolean;
    subject: Subject;
    topic: string;
    session_id: string;
  }>(
    `select a.answered_at, a.correct, q.subject::text, t.name as topic, a.session_id::text
     from public.answers a join public.questions q on q.id = a.question_id join public.topics t on t.id = q.topic_id
     where a.student_id = $1 and a.answered_at >= $2
     order by a.answered_at`,
    [studentId, since],
  );
  return rows.map((r) => ({
    answeredAt: new Date(r.answered_at),
    correct: r.correct,
    subject: r.subject,
    topic: r.topic,
    sessionId: r.session_id,
  }));
}

export type LeagueRow = {
  student_id: string;
  first_name: string;
  last_initial: string;
  answered: number;
  correct: number;
};

/**
 * This week's league: the student's group if they joined one, otherwise every senior in their
 * class. Juniors never appear in a league with strangers, only in their own group's.
 */
export async function league(sql: Sql, studentId: string, since: Date): Promise<LeagueRow[]> {
  return sql.query<LeagueRow>(
    `with me as (select id, class, group_account_id from public.students where id = $1),
     pool as (
       select s.id, s.first_name, s.last_initial from public.students s, me
       where case when me.group_account_id is not null then s.group_account_id = me.group_account_id
                  else s.class = me.class and s.group_account_id is null
                       and public.is_senior_birth_year(s.birth_year) end
     )
     select p.id::text as student_id, p.first_name, p.last_initial,
            count(a.id)::int as answered, (count(a.id) filter (where a.correct))::int as correct
     from pool p left join public.answers a on a.student_id = p.id and a.answered_at >= $2
     group by p.id, p.first_name, p.last_initial
     having count(a.id) > 0 or p.id = $1
     order by correct desc, answered desc, p.first_name`,
    [studentId, since],
  );
}

/** Undelivered "Send encouragement" messages, without marking them delivered. */
export async function pendingEncouragements(sql: Sql, studentId: string): Promise<string[]> {
  const rows = await sql.query<{ message: string }>(
    "select message from public.encouragements where student_id = $1 and delivered_at is null order by created_at",
    [studentId],
  );
  return rows.map((r) => r.message);
}

/** Undelivered "Send encouragement" messages, marked delivered as they are read. */
export async function takeEncouragements(sql: Sql, studentId: string, at: Date): Promise<string[]> {
  const rows = await sql.query<{ message: string }>(
    `update public.encouragements set delivered_at = $2
     where student_id = $1 and delivered_at is null
     returning message`,
    [studentId, at],
  );
  return rows.map((r) => r.message);
}

/** The student's live "Get sponsored" code, created on first use. */
export async function sponsorCode(sql: Sql, studentId: string): Promise<string> {
  const [existing] = await sql.query<{ code: string }>(
    "select code from public.sponsor_links where student_id = $1 and revoked_at is null",
    [studentId],
  );
  if (existing) return existing.code;
  await sql.query(
    "insert into public.sponsor_links (code, student_id) values ($1, $2) on conflict do nothing",
    [newSponsorCode(), studentId],
  );
  const [created] = await sql.query<{ code: string }>(
    "select code from public.sponsor_links where student_id = $1 and revoked_at is null",
    [studentId],
  );
  return created!.code;
}
