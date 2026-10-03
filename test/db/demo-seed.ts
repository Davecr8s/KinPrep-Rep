import type { PGlite } from "@electric-sql/pglite";
import { startFreeTrial } from "@/lib/payments/trial";
import { addDays, lagosDay, lagosDayStart } from "@/lib/rules/days";
import { DEMO_PAYERS, DEMO_STUDENTS } from "../../scripts/lib/demo-people";
import { JUNIOR_BIRTH_YEAR, SENIOR_BIRTH_YEAR } from "./harness";
import { createPgBillingStore } from "./pg-store";

// The dev seed's people (scripts/lib/demo-people.ts) in a PGlite database, as of `now`: payers,
// students with consent and plans, opt-ins, and their recent practice.

export type DemoIds = { payers: Record<string, string>; students: Record<string, string> };

export async function seedDemoPeople(db: PGlite, now: Date): Promise<DemoIds> {
  const today = lagosDay(now);
  const ids: DemoIds = { payers: {}, students: {} };
  for (const p of DEMO_PAYERS) {
    const { rows } = await db.query<{ id: string }>(
      "insert into auth.users (email) values ($1) returning id::text",
      [p.email],
    );
    const id = rows[0]!.id;
    ids.payers[p.key] = id;
    await db.query("insert into public.profiles (id, role) values ($1, 'payer')", [id]);
    await db.query(
      `insert into public.payers (id, region, currency, timezone, payer_type, whatsapp_number,
         whatsapp_reports_opt_in_at, report_weekday, report_hour)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id,
        p.region,
        p.currency,
        p.timezone,
        p.payerType,
        p.whatsapp,
        p.whatsappOptIn ? lagosDayStart(addDays(today, -30)) : null,
        p.reportWeekday,
        p.reportHour,
      ],
    );
  }

  // A small approved bank to practise with.
  const { rows: reviewer } = await db.query<{ id: string }>(
    "insert into auth.users (email) values ('reviewer@kinprep.test') returning id::text",
  );
  await db.query("insert into public.profiles (id, role) values ($1, 'reviewer')", [
    reviewer[0]!.id,
  ]);
  const questionIds: string[] = [];
  for (const [subject, topic] of [
    ["english", "Concord"],
    ["mathematics", "Algebra"],
  ] as const) {
    const { rows: t } = await db.query<{ id: string }>(
      "insert into public.topics (subject, name) values ($1, $2) returning id::text",
      [subject, topic],
    );
    for (let i = 0; i < 5; i++) {
      const { rows: q } = await db.query<{ id: string }>(
        `insert into public.questions (subject, topic_id, stem, options, answer_index, explanation_en, status, approved_by, approved_at, original_confirmed)
         values ($1, $2, $3, '["right","wrong"]', 0, 'Because.', 'approved', $4, now(), true) returning id::text`,
        [subject, t[0]!.id, `${topic} question ${i + 1}`, reviewer[0]!.id],
      );
      questionIds.push(q[0]!.id);
    }
  }

  const store = createPgBillingStore(db);
  for (const s of DEMO_STUDENTS) {
    const added = new Date(now.getTime() - s.addedDaysAgo * 86_400_000);
    const owner = ids.payers[s.owner]!;
    const { rows } = await db.query<{ id: string }>(
      `insert into public.students (owner_id, first_name, last_initial, class, birth_year, exam, subjects,
         whatsapp_number, whatsapp_opt_in_at, created_at)
       values ($1, $2, 'O', $3, $4, $5, '{english,mathematics}', $6, $7, $8) returning id::text`,
      [
        owner,
        s.firstName,
        s.class,
        s.junior ? JUNIOR_BIRTH_YEAR : SENIOR_BIRTH_YEAR,
        s.junior ? "BECE" : "WASSCE",
        s.whatsapp,
        s.dailyMessages ? added : null,
        added,
      ],
    );
    const id = rows[0]!.id;
    ids.students[s.firstName] = id;
    await db.query(
      `insert into public.guardian_consents (student_id, event, method, consent_text_version, given_by, created_at)
       values ($1, 'granted', 'web_checkbox', 'demo', $2, $3)`,
      [id, owner, added],
    );
    // Trials start at seeding, so plans are active for the next 7 days.
    if (s.plan === "trial") await startFreeTrial(store, id, now);

    // A set of 5 answers (4 right) at 12:00 Lagos on each practice day.
    for (const daysAgo of s.practisedDaysAgo) {
      const day = addDays(today, -daysAgo);
      const at = new Date(lagosDayStart(day).getTime() + 12 * 3600_000);
      const set = questionIds.slice(daysAgo % 2 ? 5 : 0).slice(0, 5);
      const { rows: session } = await db.query<{ id: string }>(
        `insert into public.practice_sessions (student_id, channel, started_at, lagos_day, question_ids, position, awaiting, completed_at)
         values ($1, 'web', $2, $3, $4::uuid[], 4, 'next', $2) returning id::text`,
        [id, at, day, `{${set.join(",")}}`],
      );
      for (const [i, q] of set.entries()) {
        await db.query(
          `insert into public.answers (session_id, student_id, question_id, chosen_index, correct, answered_at)
           values ($1, $2, $3, $4, $5, $6)`,
          [session[0]!.id, id, q, i === 4 ? 1 : 0, i !== 4, new Date(at.getTime() + i * 60_000)],
        );
      }
    }
  }
  return ids;
}
