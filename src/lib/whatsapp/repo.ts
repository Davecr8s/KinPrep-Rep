import type { Sql } from "@/lib/db/sql";
import { STUDENT_COLUMNS, type PracticeStudent } from "@/lib/practice/repo";

// Database access for the WhatsApp side of the bot: contacts, household numbers, the message log.
// Practice itself (sets, questions, answers) lives in src/lib/practice.

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

/** Students registered on this number. Only 13+ can have one (database rule); checked again here. */
export async function studentsForPhone(sql: Sql, phone: string): Promise<PracticeStudent[]> {
  return sql.query<PracticeStudent>(
    `select ${STUDENT_COLUMNS}
     from public.students
     where whatsapp_number = $1 and public.is_senior_birth_year(birth_year)
     order by created_at`,
    [phone],
  );
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
