import { z } from "zod";
import { getStudentAccess } from "@/lib/access";
import type { Sql } from "@/lib/db/sql";
import { CLASSES } from "@/lib/labels";
import { accessStore } from "@/lib/practice/repo";
import type { Access } from "@/lib/rules/access";
import { isSeniorBirthYear } from "@/lib/rules/students";
import { audit, AdminError, type Admin } from "./common";

// Students and payers for admins: search, view, pause, change class and merge duplicates.
// (Export and deletion reuse the payer app's data-rights service, src/lib/services.)

export type StudentRow = {
  id: string;
  first_name: string;
  last_initial: string;
  class: string;
  birth_year: number;
  exam: string;
  whatsapp_number: string | null;
  paused_at: Date | null;
  paused_reason: string | null;
  created_at: Date;
  owner_id: string;
  owner_email: string | null;
  owner_type: string | null;
};

const STUDENT_COLUMNS = `s.id::text, s.first_name, s.last_initial, s.class::text, s.birth_year, s.exam::text,
  s.whatsapp_number, s.paused_at, s.paused_reason, s.created_at, s.owner_id::text,
  u.email as owner_email, p.payer_type::text as owner_type`;
const STUDENT_FROM = `from public.students s
  left join auth.users u on u.id = s.owner_id
  left join public.payers p on p.id = s.owner_id`;

/** By first name, "Ada O", a payer's email, a WhatsApp number or an id. */
export async function searchStudents(sql: Sql, q: string, limit = 50): Promise<StudentRow[]> {
  const term = q.trim();
  const [first, initial] = term.split(/\s+/);
  return sql.query<StudentRow>(
    `select ${STUDENT_COLUMNS} ${STUDENT_FROM}
     where $1 = ''
        or s.id::text = $1
        or lower(s.first_name) like lower($2) || '%'
           and ($3::text is null or s.last_initial = upper($3))
        or lower(u.email) like '%' || lower($1) || '%'
        or s.whatsapp_number like '%' || regexp_replace($1, '[^0-9]', '', 'g') || '%'
           and length(regexp_replace($1, '[^0-9]', '', 'g')) >= 6
        or p.whatsapp_number like '%' || regexp_replace($1, '[^0-9]', '', 'g') || '%'
           and length(regexp_replace($1, '[^0-9]', '', 'g')) >= 6
     order by s.created_at desc
     limit $4`,
    [term, first ?? "", initial?.slice(0, 1) ?? null, limit],
  );
}

export type StudentDetail = StudentRow & {
  access: Access;
  subscriptions: {
    id: string;
    provider: string;
    plan: string;
    status: string;
    currency: string;
    current_period_end: Date | null;
    trial_end: Date | null;
  }[];
  consent: { event: string; method: string; created_at: Date } | null;
  practice: { answered: number; correct: number; last_answered: Date | null };
  siblings: { id: string; first_name: string; last_initial: string; class: string }[];
};

export async function studentDetail(
  sql: Sql,
  id: string,
  now: Date,
): Promise<StudentDetail | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const [student] = await sql.query<StudentRow>(
    `select ${STUDENT_COLUMNS} ${STUDENT_FROM} where s.id = $1`,
    [id],
  );
  if (!student) return null;
  const [subscriptions, [consent], [practice], siblings] = await Promise.all([
    sql.query<StudentDetail["subscriptions"][number]>(
      `select id::text, provider::text, plan, status::text, currency::text, current_period_end, trial_end
       from public.subscriptions where student_id = $1 order by created_at desc`,
      [id],
    ),
    sql.query<NonNullable<StudentDetail["consent"]>>(
      `select event::text, method::text, created_at from public.guardian_consents
       where student_id = $1 order by created_at desc limit 1`,
      [id],
    ),
    sql.query<StudentDetail["practice"]>(
      `select count(*)::int as answered, (count(*) filter (where correct))::int as correct,
              max(answered_at) as last_answered
       from public.answers where student_id = $1`,
      [id],
    ),
    sql.query<StudentDetail["siblings"][number]>(
      `select id::text, first_name, last_initial, class::text from public.students
       where owner_id = $1 and id <> $2 order by created_at`,
      [student.owner_id, id],
    ),
  ]);
  return {
    ...student,
    access: await getStudentAccess(id, { now, store: accessStore(sql) }),
    subscriptions,
    consent: consent ?? null,
    practice: practice!,
    siblings,
  };
}

export async function pauseStudent(
  sql: Sql,
  admin: Admin,
  id: string,
  reason: string,
  now: Date,
): Promise<void> {
  const why = reason.trim();
  if (why.length < 3 || why.length > 300)
    throw new AdminError("Give a reason (up to 300 characters).");
  const rows = await sql.query(
    "update public.students set paused_at = $2, paused_reason = $3 where id = $1 and paused_at is null returning id",
    [id, now, why],
  );
  if (!rows.length) throw new AdminError("That student is already paused, or doesn't exist.");
  await audit(sql, admin, "student.paused", "student", id, { reason: why });
}

export async function resumeStudent(sql: Sql, admin: Admin, id: string): Promise<void> {
  const rows = await sql.query(
    "update public.students set paused_at = null, paused_reason = null where id = $1 and paused_at is not null returning id",
    [id],
  );
  if (!rows.length) throw new AdminError("That student isn't paused.");
  await audit(sql, admin, "student.resumed", "student", id);
}

const JUNIOR = new Set(["JSS1", "JSS2"]);

/**
 * Moves a student up (or down) a class. Juniors stay juniors and seniors seniors: moving across
 * (JSS2 to SS1) changes the exam and WhatsApp rules, so the payer does it from the app.
 */
export async function changeClass(
  sql: Sql,
  admin: Admin,
  id: string,
  klass: string,
  now: Date,
): Promise<void> {
  if (!(CLASSES as readonly string[]).includes(klass)) throw new AdminError("Choose a class.");
  const [s] = await sql.query<{ class: string; birth_year: number; exam: string }>(
    "select class::text, birth_year, exam::text from public.students where id = $1",
    [id],
  );
  if (!s) throw new AdminError("That student doesn't exist.");
  if (JUNIOR.has(klass) !== JUNIOR.has(s.class)) {
    throw new AdminError(
      "Moving between JSS and SS changes the exam: ask the payer to update it in the app.",
    );
  }
  if (!JUNIOR.has(klass) && !isSeniorBirthYear(s.birth_year, now)) {
    throw new AdminError("That birth year is under 13: the student must stay in JSS.");
  }
  if ((klass === "UTME") !== (s.exam === "UTME")) {
    throw new AdminError("UTME candidates take UTME: ask the payer to change the exam in the app.");
  }
  await sql.query("update public.students set class = $2::public.student_class where id = $1", [
    id,
    klass,
  ]);
  await audit(sql, admin, "student.class_changed", "student", id, { from: s.class, to: klass });
}

/**
 * Merges a duplicate into the student to keep (the same child added twice by one payer): practice,
 * encouragements, viewers, alerts and messages move across, the duplicate is deleted. Refused if
 * the duplicate has a live paid plan (cancel or move it first) or belongs to someone else.
 */
export async function mergeStudents(
  sql: Sql,
  admin: Admin,
  keepId: string,
  removeId: string,
): Promise<{ sessionsMoved: number; sessionsDropped: number }> {
  if (keepId === removeId) throw new AdminError("Choose two different students.");
  return sql.transaction(async (tx) => {
    const both = await tx.query<{ id: string; owner_id: string; group_account_id: string | null }>(
      "select id::text, owner_id::text, group_account_id::text from public.students where id = any($1::uuid[]) for update",
      [`{${keepId},${removeId}}`],
    );
    const keep = both.find((s) => s.id === keepId);
    const remove = both.find((s) => s.id === removeId);
    if (!keep || !remove) throw new AdminError("One of those students doesn't exist.");
    if (keep.owner_id !== remove.owner_id) {
      throw new AdminError("Only duplicates added by the same payer can be merged.");
    }
    const [live] = await tx.query(
      `select 1 from public.subscriptions where student_id = $1 and provider <> 'trial'
         and status in ('active', 'trialing', 'past_due')`,
      [removeId],
    );
    if (live) {
      throw new AdminError("The duplicate has a live paid plan: cancel it (or move it) first.");
    }
    // Practice: move the duplicate's sessions, except days the kept student already has.
    const moved = await tx.query(
      `update public.practice_sessions d set student_id = $1
       where d.student_id = $2 and not exists (
         select 1 from public.practice_sessions k
         where k.student_id = $1 and k.channel = d.channel and k.lagos_day is not distinct from d.lagos_day)
       returning id`,
      [keepId, removeId],
    );
    await tx.query(
      "update public.answers set student_id = $1 where student_id = $2 and session_id in (select id from public.practice_sessions where student_id = $1)",
      [keepId, removeId],
    );
    const [dropped] = await tx.query<{ n: number }>(
      "select count(*)::int as n from public.practice_sessions where student_id = $1",
      [removeId],
    );
    await tx.query("update public.encouragements set student_id = $1 where student_id = $2", [
      keepId,
      removeId,
    ]);
    await tx.query(
      `insert into public.student_viewers (student_id, viewer_id, created_at)
       select $1, viewer_id, created_at from public.student_viewers where student_id = $2
       on conflict do nothing`,
      [keepId, removeId],
    );
    await tx.query(
      `update public.student_alerts a set student_id = $1 where a.student_id = $2 and not exists (
         select 1 from public.student_alerts k where k.student_id = $1 and k.kind = a.kind and k.since_day = a.since_day)`,
      [keepId, removeId],
    );
    await tx.query("update public.message_log set student_id = $1 where student_id = $2", [
      keepId,
      removeId,
    ]);
    // The kept student's own trial or plan stays; the duplicate's (trial or cancelled) goes with it,
    // unless the kept student has none.
    await tx.query(
      `update public.subscriptions set student_id = $1 where student_id = $2
         and not exists (select 1 from public.subscriptions where student_id = $1)`,
      [keepId, removeId],
    );
    await tx.query("delete from public.students where id = $1", [removeId]);
    await audit(tx, admin, "student.merged", "student", keepId, {
      merged: removeId,
      sessions_moved: moved.length,
      sessions_dropped: dropped!.n,
    });
    return { sessionsMoved: moved.length, sessionsDropped: dropped!.n };
  });
}

export type PayerRow = {
  id: string;
  email: string | null;
  payer_type: string;
  region: string;
  timezone: string;
  whatsapp_number: string | null;
  whatsapp_opt_in: boolean;
  students: number;
  created_at: Date;
};

export async function searchPayers(sql: Sql, q: string, limit = 50): Promise<PayerRow[]> {
  const term = q.trim();
  return sql.query<PayerRow>(
    `select p.id::text, u.email, p.payer_type::text, p.region::text, p.timezone, p.whatsapp_number,
            p.whatsapp_reports_opt_in_at is not null as whatsapp_opt_in,
            (select count(*)::int from public.students s where s.owner_id = p.id) as students,
            p.created_at
     from public.payers p left join auth.users u on u.id = p.id
     where $1 = '' or p.id::text = $1 or lower(u.email) like '%' || lower($1) || '%'
        or (length(regexp_replace($1, '[^0-9]', '', 'g')) >= 6
            and p.whatsapp_number like '%' || regexp_replace($1, '[^0-9]', '', 'g') || '%')
     order by p.created_at desc
     limit $2`,
    [term, limit],
  );
}
