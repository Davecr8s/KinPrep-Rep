import type { Sql } from "@/lib/db/sql";

// A student's data rights (NDPA 2023, UK GDPR; CLAUDE.md): export everything KinPrep holds about
// them, and delete it. Callers have checked that the signed-in user manages the student (or is
// an admin). Tested against the real schema in test/privacy.test.ts, which also fails if a new
// table holding student data is added without being exported and deleted here.

/** Every export section: what it holds and how it is found. Tokens and secrets are left out. */
const SECTIONS: Record<string, string> = {
  student: `select id, first_name, last_initial, class, birth_year, exam, subjects, whatsapp_number,
              language, exam_date, whatsapp_opt_in_at, paused_at, created_at
            from public.students where id = $1`,
  guardian_consents: `select event, method, consent_text_version, created_at
                      from public.guardian_consents where student_id = $1 order by created_at`,
  consent_requests: `select created_at, expires_at, accepted_at, revoked_at
                     from public.consent_requests where student_id = $1 order by created_at`,
  co_sponsors: `select created_at from public.student_viewers where student_id = $1`,
  co_sponsor_invites: `select created_at, expires_at, accepted_at
                       from public.viewer_invites where student_id = $1`,
  sponsor_links: `select created_at, revoked_at from public.sponsor_links where student_id = $1`,
  subscriptions: `select id, provider, plan, currency, status, current_period_end, trial_end,
                    grace_until, canceled_at, created_at
                  from public.subscriptions where student_id = $1 order by created_at`,
  payments: `select p.provider, p.status, p.amount_minor, p.currency, p.occurred_at,
               p.period_start, p.period_end, p.channel
             from public.payments p join public.subscriptions s on s.id = p.subscription_id
             where s.student_id = $1 order by p.occurred_at`,
  seats: `select assigned_at, released_at from public.seat_assignments where student_id = $1`,
  practice_sessions: `select id, channel, lagos_day, started_at, completed_at
                      from public.practice_sessions where student_id = $1 order by started_at`,
  answers: `select session_id, question_id, chosen_index, correct, answered_at
            from public.answers where student_id = $1 order by answered_at`,
  topic_mastery: `select m.topic_id, t.name as topic, m.attempts, m.correct, m.accuracy, m.last_attempt_at
                  from public.topic_mastery m join public.topics t on t.id = m.topic_id
                  where m.student_id = $1`,
  review_schedule: `select question_id, step, next_review_at
                    from public.question_reviews where student_id = $1`,
  practice_events: `select kind, lagos_day, created_at from public.engine_events where student_id = $1`,
  encouragements: `select message, created_at, delivered_at
                   from public.encouragements where student_id = $1 order by created_at`,
  alerts: `select kind, since_day, days, created_at from public.student_alerts where student_id = $1`,
  ai_explanations: `select question_id, language, outcome, created_at
                    from public.ai_explanation_requests where student_id = $1 order by created_at`,
  // Messages about the student, and every message to or from their own WhatsApp number.
  messages: `select direction, kind, body, status, created_at from public.message_log
             where student_id = $1
                or phone = (select whatsapp_number from public.students where id = $1)
             order by id`,
  queued_messages: `select job, channel, status, preview, lagos_day, created_at
                    from public.outbound_queue where student_id = $1 and not dry_run order by id`,
  whatsapp_contact: `select last_inbound_at, opted_out_at, created_at from public.wa_contacts
                     where phone = (select whatsapp_number from public.students where id = $1)`,
};

/** Tables holding student data, and the export section that covers each (used by the test). */
export const COVERED_TABLES: Record<string, string> = {
  students: "student",
  guardian_consents: "guardian_consents",
  consent_requests: "consent_requests",
  student_viewers: "co_sponsors",
  viewer_invites: "co_sponsor_invites",
  sponsor_links: "sponsor_links",
  subscriptions: "subscriptions",
  payments: "payments",
  seat_assignments: "seats",
  practice_sessions: "practice_sessions",
  answers: "answers",
  topic_mastery: "topic_mastery",
  question_reviews: "review_schedule",
  engine_events: "practice_events",
  encouragements: "encouragements",
  student_alerts: "alerts",
  ai_explanation_requests: "ai_explanations",
  message_log: "messages",
  outbound_queue: "queued_messages",
  wa_contacts: "whatsapp_contact",
  // Inbound webhook jobs: the same messages as message_log (direction "in"); deleted with the
  // number, and purged after 30 days anyway.
  wa_jobs: "messages",
};

export type StudentExport = { exported_at: string } & Record<string, unknown>;

export async function exportStudent(
  sql: Sql,
  studentId: string,
  requestedBy: string | null,
  now: Date,
): Promise<StudentExport | null> {
  const [student] = await sql.query(SECTIONS.student!, [studentId]);
  if (!student) return null;
  const out: StudentExport = { exported_at: now.toISOString(), student };
  for (const [name, query] of Object.entries(SECTIONS)) {
    if (name !== "student") out[name] = await sql.query(query, [studentId]);
  }
  await sql.query(
    `insert into public.data_requests (student_id, kind, status, requested_by, created_at, completed_at)
     values ($1, 'export', 'completed', $2, $3, $3)`,
    [studentId, requestedBy, now],
  );
  return out;
}

export type RenewingSubscription = { id: string; provider: "stripe" | "paystack" };

/** Subscriptions that would charge again: cancel these at the provider before deleting. */
export async function renewingSubscriptions(
  sql: Sql,
  studentId: string,
): Promise<RenewingSubscription[]> {
  return sql.query<RenewingSubscription>(
    `select id::text, provider::text as provider from public.subscriptions
     where student_id = $1 and provider in ('stripe', 'paystack') and status <> 'canceled'
       and provider_subscription_id is not null`,
    [studentId],
  );
}

/**
 * Deletes the student and everything about them, in one transaction. Their WhatsApp number's
 * messages, inbound jobs, queue items and contact record go too, unless the number is still
 * someone else's (a sibling on a household number, or a payer). The payments ledger keeps
 * amounts for the accounts but loses the link to the student. The data_requests row (id and
 * date only) is kept as the record that the deletion happened.
 */
export async function deleteStudent(
  sql: Sql,
  studentId: string,
  requestedBy: string | null,
  now: Date,
): Promise<boolean> {
  return sql.transaction(async (tx) => {
    const [student] = await tx.query<{ phone: string | null; shared: boolean }>(
      `select s.whatsapp_number as phone,
              exists (select 1 from public.students o
                      where o.whatsapp_number = s.whatsapp_number and o.id <> s.id)
              or exists (select 1 from public.payers p where p.whatsapp_number = s.whatsapp_number)
                as shared
       from public.students s where s.id = $1 for update`,
      [studentId],
    );
    if (!student) return false;
    await tx.query(
      `insert into public.data_requests (student_id, kind, status, requested_by, created_at, completed_at)
       values ($1, 'delete', 'completed', $2, $3, $3)`,
      [studentId, requestedBy, now],
    );
    if (student.phone && !student.shared) {
      await tx.query("delete from public.message_log where phone = $1", [student.phone]);
      await tx.query("delete from public.wa_jobs where phone = $1", [student.phone]);
      await tx.query("delete from public.outbound_queue where recipient = $1", [student.phone]);
      await tx.query("delete from public.wa_contacts where phone = $1", [student.phone]);
    }
    // Messages about the student to others (e.g. their parent's weekly report) name them.
    await tx.query("delete from public.message_log where student_id = $1", [studentId]);
    await tx.query("delete from public.students where id = $1", [studentId]);
    return true;
  });
}
