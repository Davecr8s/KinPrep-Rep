import { QUESTIONS_PER_DAY, type Subject } from "@/config/pilot";
import type { Sql } from "@/lib/db/sql";
import { newSponsorCode } from "@/lib/payments/codes";
import { toCoverage } from "@/lib/payments/rows";
import type { BillingStore } from "@/lib/payments/types";
import type { AnswerRow } from "@/lib/rules/progress";

// Database access for the WhatsApp bot, in plain SQL so tests (PGlite) and production
// (postgres.js) run exactly the same queries.

export type Contact = {
  phone: string;
  last_inbound_at: Date | null;
  opted_out_at: Date | null;
  active_student_id: string | null;
  active_until: Date | null;
};

/** Records that the contact just wrote to us (opens the 24-hour window). */
export async function touchContact(sql: Sql, phone: string, at: Date): Promise<Contact> {
  const [row] = await sql.query<Contact>(
    `insert into public.wa_contacts (phone, last_inbound_at) values ($1, $2)
     on conflict (phone) do update
       set last_inbound_at = greatest(public.wa_contacts.last_inbound_at, excluded.last_inbound_at)
     returning phone, last_inbound_at, opted_out_at, active_student_id::text, active_until`,
    [phone, at],
  );
  return row!;
}

export async function setOptedOut(sql: Sql, phone: string, at: Date | null): Promise<void> {
  await sql.query("update public.wa_contacts set opted_out_at = $2 where phone = $1", [phone, at]);
}

export async function setActiveStudent(
  sql: Sql,
  phone: string,
  studentId: string | null,
  until: Date | null,
) {
  await sql.query(
    "update public.wa_contacts set active_student_id = $2, active_until = $3 where phone = $1",
    [phone, studentId, until],
  );
}

export type BotStudent = {
  id: string;
  first_name: string;
  last_initial: string;
  class: string;
  subjects: Subject[];
  language: "en" | "pcm";
  group_account_id: string | null;
};

/** Students registered on this number. Only 13+ can have one (database rule); checked again here. */
export async function studentsForPhone(sql: Sql, phone: string): Promise<BotStudent[]> {
  return sql.query<BotStudent>(
    `select id::text, first_name, last_initial, class::text, subjects::text[] as subjects, language::text,
            group_account_id::text
     from public.students
     where whatsapp_number = $1 and public.is_senior_birth_year(birth_year)
     order by created_at`,
    [phone],
  );
}

/** What isStudentActive needs, read through the same SQL connection. */
export function accessStore(sql: Sql): Pick<BillingStore, "getCoverages" | "hasGuardianConsent"> {
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
  };
}

export type Session = {
  id: string;
  question_ids: string[];
  position: number;
  awaiting: "answer" | "next";
  completed_at: Date | null;
};

const SESSION_COLUMNS =
  "id::text, question_ids::text[] as question_ids, position, awaiting, completed_at";

export async function todaySession(
  sql: Sql,
  studentId: string,
  day: string,
): Promise<Session | null> {
  const [row] = await sql.query<Session>(
    `select ${SESSION_COLUMNS} from public.practice_sessions
     where student_id = $1 and channel = 'whatsapp' and lagos_day = $2`,
    [studentId, day],
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
  day: string,
  questionIds: string[],
  at: Date,
): Promise<Session> {
  await sql.query(
    `insert into public.practice_sessions (student_id, channel, started_at, lagos_day, question_ids)
     values ($1, 'whatsapp', $2, $3, $4::uuid[])
     on conflict do nothing`,
    [studentId, at, day, questionIds],
  );
  return (await todaySession(sql, studentId, day))!;
}

export async function updateSession(
  sql: Sql,
  sessionId: string,
  change: { position: number; awaiting: "answer" | "next"; completedAt?: Date | null },
) {
  await sql.query(
    "update public.practice_sessions set position = $2, awaiting = $3, completed_at = $4, ended_at = $4 where id = $1",
    [sessionId, change.position, change.awaiting, change.completedAt ?? null],
  );
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

/**
 * Today's set: approved questions only, in the student's subjects, ones they haven't seen first,
 * spread across subjects in turn.
 */
export async function pickQuestions(
  sql: Sql,
  student: BotStudent,
  count: number,
): Promise<string[]> {
  const rows = await sql.query<{ id: string; subject: string; seen: boolean }>(
    `select q.id::text, q.subject::text,
            exists (select 1 from public.answers a where a.student_id = $1 and a.question_id = q.id) as seen
     from public.questions q
     where q.status = 'approved' and q.subject::text = any($2::text[])
     order by seen, random()
     limit $3`,
    [student.id, student.subjects, count * 6],
  );
  const bySubject = new Map<string, string[]>();
  for (const r of rows) bySubject.set(r.subject, [...(bySubject.get(r.subject) ?? []), r.id]);
  const queues = [...bySubject.values()];
  const picked: string[] = [];
  while (picked.length < count && queues.some((q) => q.length > 0)) {
    for (const q of queues) {
      const id = q.shift();
      if (id && picked.length < count) picked.push(id);
    }
  }
  return picked;
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

export async function recordAnswer(
  sql: Sql,
  a: {
    sessionId: string;
    studentId: string;
    questionId: string;
    chosen: number;
    correct: boolean;
    at: Date;
  },
) {
  await sql.query(
    `insert into public.answers (session_id, student_id, question_id, chosen_index, correct, answered_at)
     values ($1, $2, $3, $4, $5, $6) on conflict (session_id, question_id) do nothing`,
    [a.sessionId, a.studentId, a.questionId, a.chosen, a.correct, a.at],
  );
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

/** This week's league: the student's group if they joined one, otherwise everyone in their class. */
export async function league(sql: Sql, studentId: string, since: Date): Promise<LeagueRow[]> {
  return sql.query<LeagueRow>(
    `with me as (select id, class, group_account_id from public.students where id = $1),
     pool as (
       select s.id, s.first_name, s.last_initial from public.students s, me
       where case when me.group_account_id is not null then s.group_account_id = me.group_account_id
                  else s.class = me.class and s.group_account_id is null end
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

export async function logInbound(
  sql: Sql,
  m: {
    phone: string;
    studentId?: string | null;
    waId: string;
    kind: string;
    body: unknown;
    simulated: boolean;
  },
) {
  await sql.query(
    `insert into public.message_log (direction, phone, student_id, wa_message_id, kind, body, status, simulated)
     values ('in', $1, $2, $3, $4, $5::jsonb, 'received', $6)`,
    [m.phone, m.studentId ?? null, m.waId, m.kind, JSON.stringify(m.body), m.simulated],
  );
}
