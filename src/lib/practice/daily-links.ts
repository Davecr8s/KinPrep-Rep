import { isStudentActive } from "@/lib/access";
import type { Sql } from "@/lib/db/sql";
import { practiceUrl, signPracticeLink, LINK_TTL_MS } from "./links";
import { accessStore } from "./repo";

// Today's practice links for every active student, in one go (admin, and the pilot console).
// A junior's link always goes to the adult who manages them, never to the child (CLAUDE.md);
// a senior's goes to their own WhatsApp number, or to the adult if they don't have one.

export type DailyLink = {
  studentId: string;
  firstName: string;
  lastInitial: string;
  class: string;
  junior: boolean;
  url: string;
  expiresAt: Date;
  sendTo: { who: "parent" | "student"; whatsapp: string | null; email: string | null };
  /** Ready-to-send text, for WhatsApp or email. */
  message: string;
};

type Row = {
  id: string;
  first_name: string;
  last_initial: string;
  class: string;
  junior: boolean;
  student_whatsapp: string | null;
  owner_whatsapp: string | null;
  owner_email: string | null;
};

const lagosTime = (at: Date) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Lagos",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(at);

export async function todaysLinks(
  sql: Sql,
  input: { appUrl: string; secret: string; issuedAt: Date },
): Promise<DailyLink[]> {
  const rows = await sql.query<Row>(
    `select s.id::text, s.first_name, s.last_initial, s.class::text,
            not public.is_senior_birth_year(s.birth_year) as junior,
            s.whatsapp_number as student_whatsapp, p.whatsapp_number as owner_whatsapp,
            u.email as owner_email
     from public.students s
     left join public.payers p on p.id = s.owner_id
     left join auth.users u on u.id = s.owner_id
     order by s.first_name, s.last_initial, s.id`,
  );
  const store = accessStore(sql);
  const expiresAt = new Date(input.issuedAt.getTime() + LINK_TTL_MS);
  const links: DailyLink[] = [];
  for (const r of rows) {
    // Active means consent recorded and a live plan: the one access rule (isStudentActive).
    if (!(await isStudentActive(r.id, { now: input.issuedAt, store }))) continue;
    const url = practiceUrl(
      input.appUrl,
      signPracticeLink({ studentId: r.id, issuedAt: input.issuedAt }, input.secret),
    );
    const toStudent = !r.junior && r.student_whatsapp !== null;
    const until = lagosTime(expiresAt);
    links.push({
      studentId: r.id,
      firstName: r.first_name,
      lastInitial: r.last_initial,
      class: r.class,
      junior: r.junior,
      url,
      expiresAt,
      sendTo: toStudent
        ? { who: "student", whatsapp: r.student_whatsapp, email: null }
        : { who: "parent", whatsapp: r.owner_whatsapp, email: r.owner_email },
      message: toStudent
        ? `Hi ${r.first_name}! Here are today's KinPrep questions (link works until ${until}, Lagos time): ${url}`
        : `Good morning! Here is ${r.first_name}'s KinPrep practice for today. Open it on your phone and hand it to ${r.first_name} (link works until ${until}, Lagos time): ${url}`,
    });
  }
  return links;
}
