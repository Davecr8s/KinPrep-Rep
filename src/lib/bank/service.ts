import { z } from "zod";
import { SUBJECTS, type Subject } from "@/config/pilot";
import type { Sql } from "@/lib/db/sql";
import { bankRunway } from "@/lib/engine";
import { lagosDayStart, addDays, lagosDay } from "@/lib/rules/days";
import type { QuestionDrafter } from "./llm";
import {
  importRows,
  lowCorrectRates,
  toCsv,
  type CsvQuestion,
  type ImportError,
  type LowCorrectRate,
  type QuestionInput,
} from "./rules";

// The question bank behind /admin/questions. Every function takes the signed-in staff member and
// checks their role again here; every change is written to audit_log; every review decision to
// question_review_log (reviewers are paid per question from it).

export class BankError extends Error {}

export type Staff = { id: string; role: "admin" | "reviewer" };

/** Admins and reviewers may use the bank; only admins change the syllabus. */
export async function staffMember(sql: Sql, userId: string): Promise<Staff> {
  const [row] = await sql.query<{ role: string }>(
    "select role::text from public.profiles where id = $1",
    [userId],
  );
  if (row?.role !== "admin" && row?.role !== "reviewer") {
    throw new BankError("Only admins and reviewers can use the question bank.");
  }
  return { id: userId, role: row.role };
}

async function audit(
  sql: Sql,
  actor: Staff,
  action: string,
  entityType: string,
  entityId: string | null,
  details: Record<string, unknown> = {},
) {
  await sql.query(
    `insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
     values ($1, $2, $3, $4, $5::jsonb)`,
    [actor.id, action, entityType, entityId, JSON.stringify(details)],
  );
}

// ---- Syllabus ----------------------------------------------------------------------------

export type TopicRow = {
  id: string;
  subject: Subject;
  name: string;
  jamb_ref: string | null;
  waec_ref: string | null;
  approved: number;
  flagged: number;
  waiting: number;
  rejected: number;
};

export async function listTopics(sql: Sql): Promise<TopicRow[]> {
  return sql.query<TopicRow>(
    `select t.id::text, t.subject::text, t.name, t.jamb_ref, t.waec_ref,
            (count(q.id) filter (where q.status = 'approved' and q.flagged_at is null))::int as approved,
            (count(q.id) filter (where q.status = 'approved' and q.flagged_at is not null))::int as flagged,
            (count(q.id) filter (where q.status in ('draft', 'in_review')))::int as waiting,
            (count(q.id) filter (where q.status = 'rejected'))::int as rejected
     from public.topics t left join public.questions q on q.topic_id = t.id
     group by t.id
     order by t.subject, t.sort_order, t.name`,
  );
}

const optionalRef = z
  .string()
  .trim()
  .max(200, "Keep the reference under 200 characters.")
  .transform((v) => v || null);

export const TopicInputSchema = z.object({
  subject: z.enum(SUBJECTS, { error: "Choose a subject." }),
  name: z.string().trim().min(2, "Name the topic.").max(80, "Keep the name under 80 characters."),
  jambRef: optionalRef,
  waecRef: optionalRef,
});
export type TopicInput = z.output<typeof TopicInputSchema>;

export async function saveTopic(
  sql: Sql,
  staff: Staff,
  input: TopicInput,
  id?: string,
): Promise<string> {
  if (staff.role !== "admin") throw new BankError("Only admins can change the syllabus.");
  const clash = await sql.query(
    "select 1 from public.topics where subject = $1 and lower(name) = lower($2) and id is distinct from $3::uuid",
    [input.subject, input.name, id ?? null],
  );
  if (clash.length) throw new BankError(`There is already a topic called "${input.name}".`);
  if (id) {
    const rows = await sql.query(
      `update public.topics set name = $2, jamb_ref = $3, waec_ref = $4 where id = $1 returning id`,
      [id, input.name, input.jambRef, input.waecRef],
    );
    if (!rows.length) throw new BankError("That topic doesn't exist.");
    await audit(sql, staff, "topic.updated", "topic", id, input);
    return id;
  }
  const [row] = await sql.query<{ id: string }>(
    `insert into public.topics (subject, name, jamb_ref, waec_ref,
       sort_order) values ($1, $2, $3, $4,
       (select coalesce(max(sort_order), 0) + 1 from public.topics where subject = $1))
     returning id::text`,
    [input.subject, input.name, input.jambRef, input.waecRef],
  );
  await audit(sql, staff, "topic.created", "topic", row!.id, input);
  return row!.id;
}

// ---- Questions ---------------------------------------------------------------------------

export type BankQuestion = {
  id: string;
  subject: Subject;
  topic_id: string;
  topic: string;
  stem: string;
  options: string[];
  answer_index: number;
  explanation_en: string;
  explanation_pcm: string | null;
  classes: string[];
  syllabus_ref: string | null;
  status: "draft" | "in_review" | "approved" | "rejected" | "retired";
  source: "human" | "ai_draft" | "import";
  original_confirmed: boolean;
  answer_checked: boolean;
  explanation_checked: boolean;
  flagged_at: Date | null;
  flag_reason: string | null;
  rejection_reason: string | null;
  created_at: Date;
  reviewed_at: Date | null;
  reviewer_email: string | null;
};

const QUESTION_COLUMNS = `q.id::text, q.subject::text, q.topic_id::text, t.name as topic, q.stem, q.options,
  q.answer_index, q.explanation_en, q.explanation_pcm, q.classes::text[] as classes, q.syllabus_ref,
  q.status::text, q.source::text, q.original_confirmed, q.answer_checked, q.explanation_checked,
  q.flagged_at, q.flag_reason, q.rejection_reason, q.created_at, q.reviewed_at,
  ru.email as reviewer_email`;
const QUESTION_FROM = `from public.questions q
  join public.topics t on t.id = q.topic_id
  left join auth.users ru on ru.id = q.reviewed_by`;

const withOptions = (q: BankQuestion): BankQuestion => ({
  ...q,
  options: typeof q.options === "string" ? JSON.parse(q.options) : q.options,
});

export async function getBankQuestion(sql: Sql, id: string): Promise<BankQuestion | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const [row] = await sql.query<BankQuestion>(
    `select ${QUESTION_COLUMNS} ${QUESTION_FROM} where q.id = $1`,
    [id],
  );
  return row ? withOptions(row) : null;
}

export async function listQuestions(
  sql: Sql,
  filter: { status?: string; subject?: string; topicId?: string; limit?: number } = {},
): Promise<BankQuestion[]> {
  const rows = await sql.query<BankQuestion>(
    `select ${QUESTION_COLUMNS} ${QUESTION_FROM}
     where ($1::text is null or q.status::text = $1)
       and ($2::text is null or q.subject::text = $2)
       and ($3::uuid is null or q.topic_id = $3::uuid)
     order by q.created_at desc
     limit $4`,
    [filter.status ?? null, filter.subject ?? null, filter.topicId ?? null, filter.limit ?? 200],
  );
  return rows.map(withOptions);
}

/** Waiting for a reviewer: drafts (AI and imported), questions sent for review, and flags. */
export async function reviewQueue(sql: Sql): Promise<BankQuestion[]> {
  const rows = await sql.query<BankQuestion>(
    `select ${QUESTION_COLUMNS} ${QUESTION_FROM}
     where q.status in ('draft', 'in_review') or (q.status = 'approved' and q.flagged_at is not null)
     order by (q.flagged_at is null), q.created_at
     limit 200`,
  );
  return rows.map(withOptions);
}

async function topicSubject(sql: Sql, topicId: string): Promise<Subject> {
  const [topic] = await sql.query<{ subject: Subject }>(
    "select subject::text from public.topics where id = $1",
    [topicId],
  );
  if (!topic) throw new BankError("Choose a topic.");
  return topic.subject;
}

export type SaveMode = "draft" | "review" | "approve";

/**
 * Saves the editor's question. "draft" keeps it to work on, "review" sends it to the queue, and
 * "approve" (edit and approve) makes it live: the writer or reviewer must have ticked "original,
 * not from a past paper", and an AI draft needs its answer and explanation confirmed.
 */
export async function saveQuestion(
  sql: Sql,
  staff: Staff,
  input: QuestionInput,
  options: { id?: string; mode: SaveMode; checks?: { answer: boolean; explanation: boolean } },
): Promise<string> {
  return sql.transaction(async (tx) => {
    const subject = await topicSubject(tx, input.topicId);
    const existing = options.id ? await getBankQuestion(tx, options.id) : null;
    if (options.id && !existing) throw new BankError("That question doesn't exist.");
    const source = existing?.source ?? "human";
    const approving = options.mode === "approve";
    const answerChecked = options.checks?.answer ?? false;
    const explanationChecked = options.checks?.explanation ?? false;
    if (approving && !input.originalConfirmed) {
      throw new BankError("Tick “original question, not from a past paper” before approving.");
    }
    if (approving && source === "ai_draft" && !(answerChecked && explanationChecked)) {
      throw new BankError("For an AI draft, confirm both the answer and the explanation.");
    }
    const status = approving ? "approved" : options.mode === "review" ? "in_review" : "draft";
    const values = [
      subject,
      input.topicId,
      input.stem,
      JSON.stringify(input.options),
      input.answerIndex,
      input.explanationEn,
      input.explanationPcm,
      `{${input.classes.join(",")}}`,
      input.syllabusRef,
      status,
      input.originalConfirmed,
      approving ? answerChecked || source !== "ai_draft" : false,
      approving ? explanationChecked || source !== "ai_draft" : false,
      approving ? staff.id : null,
    ];
    let id: string;
    if (existing) {
      await tx.query(
        `update public.questions set subject = $2, topic_id = $3, stem = $4, options = $5::jsonb,
           answer_index = $6, explanation_en = $7, explanation_pcm = $8,
           classes = $9::public.student_class[], syllabus_ref = $10, status = $11::public.question_status,
           original_confirmed = $12, answer_checked = $13, explanation_checked = $14,
           approved_by = case when $11::text = 'approved' then $15::uuid else approved_by end,
           approved_at = case when $11::text = 'approved' then now() else approved_at end,
           reviewed_by = coalesce($15::uuid, reviewed_by),
           reviewed_at = case when $15::uuid is null then reviewed_at else now() end,
           flagged_at = case when $11::text = 'approved' then null else flagged_at end,
           flag_reason = case when $11::text = 'approved' then null else flag_reason end,
           rejection_reason = null, updated_at = now()
         where id = $1`,
        [existing.id, ...values],
      );
      id = existing.id;
    } else {
      const [row] = await tx.query<{ id: string }>(
        `insert into public.questions (subject, topic_id, stem, options, answer_index, explanation_en,
           explanation_pcm, classes, syllabus_ref, status, original_confirmed, answer_checked,
           explanation_checked, reviewed_by, reviewed_at, approved_by, approved_at, created_by, source)
         values ($1, $2, $3, $4::jsonb, $5, $6, $7, $8::public.student_class[], $9,
           $10::public.question_status, $11, $12, $13, $14::uuid,
           case when $14::uuid is null then null else now() end, $14::uuid,
           case when $14::uuid is null then null else now() end, $15, 'human')
         returning id::text`,
        [...values, staff.id],
      );
      id = row!.id;
    }
    if (approving) {
      await tx.query(
        `insert into public.question_review_log (question_id, reviewer_id, action, source)
         values ($1, $2, $3, $4::public.question_source)`,
        [id, staff.id, existing ? "edited_approved" : "approved", source],
      );
    }
    await audit(tx, staff, existing ? "question.updated" : "question.created", "question", id, {
      status,
      source,
    });
    return id;
  });
}

export type Decision =
  | {
      action: "approve";
      answerChecked: boolean;
      explanationChecked: boolean;
      originalConfirmed: boolean;
    }
  | { action: "reject"; reason: string }
  | { action: "flag"; reason: string }
  | { action: "clear" }
  | { action: "retire"; reason: string };

/** A reviewer's decision on one question from the queue (or the bank health page). */
export async function reviewQuestion(
  sql: Sql,
  staff: Staff,
  id: string,
  decision: Decision,
): Promise<void> {
  await sql.transaction(async (tx) => {
    const q = await getBankQuestion(tx, id);
    if (!q) throw new BankError("That question doesn't exist.");
    const reason = "reason" in decision ? decision.reason.trim() : null;
    if (reason !== null && reason.length < 3) throw new BankError("Give a reason.");
    if (reason !== null && reason.length > 500)
      throw new BankError("Keep the reason under 500 characters.");
    const log = (action: string) =>
      tx.query(
        `insert into public.question_review_log (question_id, reviewer_id, action, source, reason)
         values ($1, $2, $3, $4::public.question_source, $5)`,
        [id, staff.id, action, q.source, reason],
      );

    switch (decision.action) {
      case "approve": {
        const waiting = q.status === "draft" || q.status === "in_review";
        if (!waiting && !(q.status === "approved" && q.flagged_at)) {
          throw new BankError("This question isn't waiting for review.");
        }
        if (!decision.originalConfirmed) {
          throw new BankError("Tick “original question, not from a past paper” before approving.");
        }
        if (q.source === "ai_draft" && !(decision.answerChecked && decision.explanationChecked)) {
          throw new BankError("For an AI draft, confirm both the answer and the explanation.");
        }
        await tx.query(
          `update public.questions set status = 'approved', original_confirmed = true,
             answer_checked = $3, explanation_checked = $4,
             approved_by = $2, approved_at = now(), reviewed_by = $2, reviewed_at = now(),
             flagged_at = null, flag_reason = null, rejection_reason = null, updated_at = now()
           where id = $1`,
          [
            id,
            staff.id,
            decision.answerChecked || q.source !== "ai_draft",
            decision.explanationChecked || q.source !== "ai_draft",
          ],
        );
        await log("approved");
        break;
      }
      case "reject":
        if (q.status === "approved" || q.status === "retired") {
          throw new BankError("Retire an approved question instead of rejecting it.");
        }
        await tx.query(
          `update public.questions set status = 'rejected', rejection_reason = $3,
             reviewed_by = $2, reviewed_at = now(), updated_at = now() where id = $1`,
          [id, staff.id, reason],
        );
        await log("rejected");
        break;
      case "flag":
        if (q.status !== "approved") throw new BankError("Only approved questions can be flagged.");
        await tx.query(
          "update public.questions set flagged_at = now(), flag_reason = $2, updated_at = now() where id = $1",
          [id, reason],
        );
        await log("flagged");
        break;
      case "clear":
        if (!q.flagged_at) throw new BankError("This question isn't flagged.");
        await tx.query(
          `update public.questions set flagged_at = null, flag_reason = null,
             reviewed_by = $2, reviewed_at = now(), updated_at = now() where id = $1`,
          [id, staff.id],
        );
        await log("cleared");
        break;
      case "retire":
        await tx.query(
          `update public.questions set status = 'retired', flagged_at = null,
             reviewed_by = $2, reviewed_at = now(), updated_at = now() where id = $1`,
          [id, staff.id],
        );
        await log("retired");
        break;
    }
    await audit(tx, staff, `question.${decision.action}`, "question", id, reason ? { reason } : {});
  });
}

// ---- AI drafts ---------------------------------------------------------------------------

const SENIOR_CLASSES = ["SS1", "SS2", "SS3", "UTME"];

/**
 * "Draft 10 questions for this topic". Saved as status draft, source ai_draft: never sent to a
 * student (buildDailySet takes approved questions only) until a reviewer checks and approves it.
 */
export async function draftQuestions(
  sql: Sql,
  staff: Staff,
  drafter: QuestionDrafter,
  topicId: string,
  count = 10,
): Promise<{ created: number }> {
  const [topic] = await sql.query<{
    subject: Subject;
    name: string;
    jamb_ref: string | null;
    waec_ref: string | null;
  }>("select subject::text, name, jamb_ref, waec_ref from public.topics where id = $1", [topicId]);
  if (!topic) throw new BankError("That topic doesn't exist.");
  const existing = await sql.query<{ stem: string }>(
    "select stem from public.questions where topic_id = $1 and status <> 'rejected' order by created_at desc limit 60",
    [topicId],
  );
  const drafts = await drafter.draft({
    subject: topic.subject,
    topic: topic.name,
    jambRef: topic.jamb_ref,
    waecRef: topic.waec_ref,
    classes: SENIOR_CLASSES,
    count,
    avoid: existing.map((e) => e.stem),
  });
  await sql.transaction(async (tx) => {
    for (const d of drafts.slice(0, count)) {
      await tx.query(
        `insert into public.questions (subject, topic_id, stem, options, answer_index, explanation_en,
           explanation_pcm, classes, status, source, created_by)
         values ($1, $2, $3, $4::jsonb, $5, $6, $7, $8::public.student_class[], 'draft', 'ai_draft', $9)`,
        [
          topic.subject,
          topicId,
          d.stem,
          JSON.stringify(d.options),
          d.answer_index,
          d.explanation_en,
          d.explanation_pcm,
          `{${SENIOR_CLASSES.join(",")}}`,
          staff.id,
        ],
      );
    }
    await audit(tx, staff, "question.ai_drafted", "topic", topicId, {
      requested: count,
      created: Math.min(drafts.length, count),
    });
  });
  return { created: Math.min(drafts.length, count) };
}

// ---- Reviewer pay -----------------------------------------------------------------------

export type ReviewerWeek = {
  week: string;
  reviewer_id: string;
  email: string | null;
  approved: number;
  edited: number;
  rejected: number;
  total: number;
};

/** Review decisions per reviewer per week (Monday to Sunday, Lagos), for paying per question. */
export async function reviewerWeeklyCounts(
  sql: Sql,
  now: Date,
  weeks = 8,
): Promise<ReviewerWeek[]> {
  return sql.query<ReviewerWeek>(
    `select to_char(date_trunc('week', l.created_at at time zone 'Africa/Lagos'), 'YYYY-MM-DD') as week,
            l.reviewer_id::text, u.email,
            (count(*) filter (where l.action = 'approved'))::int as approved,
            (count(*) filter (where l.action = 'edited_approved'))::int as edited,
            (count(*) filter (where l.action = 'rejected'))::int as rejected,
            count(*)::int as total
     from public.question_review_log l
     left join auth.users u on u.id = l.reviewer_id
     where l.action in ('approved', 'edited_approved', 'rejected')
       and l.created_at >= $1
     group by 1, l.reviewer_id, u.email
     order by 1 desc, total desc`,
    [lagosDayStart(addDays(lagosDay(now), -7 * weeks))],
  );
}

// ---- CSV --------------------------------------------------------------------------------

export async function exportCsv(sql: Sql, filter: { status?: string } = {}): Promise<string> {
  const rows = await listQuestions(sql, { status: filter.status, limit: 100_000 });
  return toCsv(
    rows.map((q): CsvQuestion => ({
      id: q.id,
      subject: q.subject,
      topic: q.topic,
      stem: q.stem,
      options: q.options,
      answerIndex: q.answer_index,
      explanationEn: q.explanation_en,
      explanationPcm: q.explanation_pcm,
      classes: q.classes,
      syllabusRef: q.syllabus_ref,
      originalConfirmed: q.original_confirmed,
      status: q.status,
      source: q.source,
    })),
  );
}

/** Imports questions as drafts (source import) for review. Nothing is approved by an import. */
export async function importCsv(
  sql: Sql,
  staff: Staff,
  csv: string,
): Promise<{ created: number; errors: ImportError[] }> {
  const { rows, errors } = importRows(csv);
  const topics = await sql.query<{ id: string; subject: string; name: string }>(
    "select id::text, subject::text, lower(name) as name from public.topics",
  );
  let created = 0;
  await sql.transaction(async (tx) => {
    for (const r of rows) {
      const topic = topics.find((t) => t.subject === r.subject && t.name === r.topic.toLowerCase());
      if (!topic) {
        errors.push({ line: r.line, message: `No ${r.subject} topic called "${r.topic}".` });
        continue;
      }
      await tx.query(
        `insert into public.questions (subject, topic_id, stem, options, answer_index, explanation_en,
           explanation_pcm, classes, syllabus_ref, original_confirmed, status, source, created_by)
         values ($1, $2, $3, $4::jsonb, $5, $6, $7, $8::public.student_class[], $9, $10, 'draft', 'import', $11)`,
        [
          r.subject,
          topic.id,
          r.input.stem,
          JSON.stringify(r.input.options),
          r.input.answerIndex,
          r.input.explanationEn,
          r.input.explanationPcm,
          `{${r.input.classes.join(",")}}`,
          r.input.syllabusRef,
          r.input.originalConfirmed,
          staff.id,
        ],
      );
      created += 1;
    }
    await audit(tx, staff, "question.imported", "question", null, {
      created,
      errors: errors.length,
    });
  });
  errors.sort((a, b) => a.line - b.line);
  return { created, errors };
}

// ---- Bank health ------------------------------------------------------------------------

export const LOW_TOPIC_THRESHOLD = 10;

export type BankHealth = {
  subjects: { subject: Subject; approved: number; runway: number }[];
  topics: (TopicRow & { low: boolean })[];
  shortages: {
    subject: Subject;
    topic: string;
    students: number;
    days: number;
    last_day: string;
  }[];
  recheck: (LowCorrectRate & { stem: string; topic: string; subject: Subject; flagged: boolean })[];
};

export async function bankHealth(sql: Sql, now: Date): Promise<BankHealth> {
  const topics = await listTopics(sql);
  const subjects = [];
  for (const subject of SUBJECTS) {
    subjects.push({
      subject,
      approved: topics.filter((t) => t.subject === subject).reduce((n, t) => n + t.approved, 0),
      runway: await bankRunway(sql, subject, now),
    });
  }
  const shortages = await sql.query<BankHealth["shortages"][number]>(
    `select e.subject::text, t.name as topic, count(distinct e.student_id)::int as students,
            count(distinct e.lagos_day)::int as days, max(e.lagos_day)::text as last_day
     from public.engine_events e join public.topics t on t.id = e.topic_id
     where e.kind = 'bank_shortage' and e.lagos_day >= $1
     group by e.subject, t.name
     order by max(e.lagos_day) desc, count(distinct e.student_id) desc
     limit 50`,
    [addDays(lagosDay(now), -14)],
  );
  const stats = await sql.query<{
    id: string;
    topic_id: string;
    answer_index: number;
    attempts: number;
    correct: number;
    chosen: number[];
  }>(
    `select q.id::text, q.topic_id::text, q.answer_index,
            count(a.id)::int as attempts, (count(a.id) filter (where a.correct))::int as correct,
            array[(count(a.id) filter (where a.chosen_index = 0))::int,
                  (count(a.id) filter (where a.chosen_index = 1))::int,
                  (count(a.id) filter (where a.chosen_index = 2))::int,
                  (count(a.id) filter (where a.chosen_index = 3))::int,
                  (count(a.id) filter (where a.chosen_index = 4))::int] as chosen
     from public.questions q join public.answers a on a.question_id = q.id
     where q.status = 'approved'
     group by q.id`,
  );
  const low = lowCorrectRates(
    stats.map((s) => ({
      id: s.id,
      topicId: s.topic_id,
      attempts: s.attempts,
      correct: s.correct,
      chosen: s.chosen,
      answerIndex: s.answer_index,
    })),
  );
  const details = low.length
    ? await sql.query<{
        id: string;
        stem: string;
        topic: string;
        subject: Subject;
        flagged: boolean;
      }>(
        `select q.id::text, q.stem, t.name as topic, q.subject::text, q.flagged_at is not null as flagged
         from public.questions q join public.topics t on t.id = q.topic_id
         where q.id = any($1::uuid[])`,
        [`{${low.map((l) => l.id).join(",")}}`],
      )
    : [];
  return {
    subjects,
    topics: topics.map((t) => ({ ...t, low: t.approved < LOW_TOPIC_THRESHOLD })),
    shortages,
    recheck: low.map((l) => ({ ...l, ...details.find((d) => d.id === l.id)! })),
  };
}
