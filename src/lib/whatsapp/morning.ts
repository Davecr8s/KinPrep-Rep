import { isStudentActive } from "@/lib/access";
import type { Sql } from "@/lib/db/sql";
import type { Outbox } from "./outbox";
import { accessStore } from "@/lib/practice/repo";
import { studentsForPhone } from "./repo";

/**
 * The morning nudge: the approved template (with a "Start" quick reply) to every number with at
 * least one active, consented student aged 13+. One per household number. The outbox blocks
 * anyone who sent STOP; templates are allowed outside the 24-hour window.
 */
export async function sendMorningNudges(
  sql: Sql,
  outbox: Outbox,
  template: { name: string; language: string },
  now: Date = new Date(),
): Promise<{ sent: number; skipped: number }> {
  const phones = await sql.query<{ phone: string }>(
    `select distinct s.whatsapp_number as phone
     from public.students s
     left join public.wa_contacts c on c.phone = s.whatsapp_number
     where s.whatsapp_number is not null and c.opted_out_at is null`,
  );
  const store = accessStore(sql);
  let sent = 0;
  let skipped = 0;
  for (const { phone } of phones) {
    const students = await studentsForPhone(sql, phone);
    const active = [];
    for (const s of students) if (await isStudentActive(s.id, { now, store })) active.push(s);
    if (active.length === 0) {
      skipped += 1;
      continue;
    }
    const result = await outbox.send(
      phone,
      { kind: "template", ...template },
      {
        businessInitiated: true,
        studentId: active.length === 1 ? active[0]!.id : null,
      },
    );
    if (result === "sent" || result === "simulated") sent += 1;
    else skipped += 1;
  }
  return { sent, skipped };
}
