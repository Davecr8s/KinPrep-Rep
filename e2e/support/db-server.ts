// A throwaway Postgres for the end-to-end tests: PGlite (in memory) with every migration applied,
// served over the Postgres wire protocol so the app's own postgres.js client talks to it exactly
// as it talks to Supabase. Seeds the fake students the practice tests use. Started by Playwright
// (playwright.config.ts); nothing here touches a real database.
// Usage: node e2e/support/db-server.ts
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { createTestDb } from "../../test/db/harness.ts";
import { E2E_DB_PORT, E2E_STUDENTS } from "./fixtures.ts";

const db = await createTestDb();

const lagosYear = Number(
  new Intl.DateTimeFormat("en", { timeZone: "Africa/Lagos", year: "numeric" }).format(new Date()),
);

const [parent] = (
  await db.query<{ id: string }>(
    "insert into auth.users (email) values ('e2e-parent@example.com') returning id",
  )
).rows;
await db.query("insert into public.profiles (id, role) values ($1, 'payer')", [parent!.id]);
await db.query(
  "insert into public.payers (id, region, currency, timezone, payer_type) values ($1, 'nigeria', 'NGN', 'Africa/Lagos', 'parent')",
  [parent!.id],
);

for (const s of Object.values(E2E_STUDENTS)) {
  await db.query(
    `insert into public.students (id, owner_id, first_name, last_initial, class, birth_year, exam, subjects, whatsapp_number)
     values ($1, $2, $3, 'A', $4, $5, $6, '{english,mathematics}', $7)`,
    [
      s.id,
      parent!.id,
      s.firstName,
      s.junior ? "JSS1" : "SS2",
      s.junior ? lagosYear - 11 : lagosYear - 16,
      s.junior ? "BECE" : "WASSCE",
      s.junior ? null : s.whatsapp,
    ],
  );
  await db.query(
    `insert into public.guardian_consents (student_id, event, method, consent_text_version, given_by)
     values ($1, 'granted', 'web_checkbox', 'e2e', $2)`,
    [s.id, parent!.id],
  );
  const now = new Date();
  const trialEnd = new Date(now.getTime() + 7 * 864e5).toISOString();
  await db.query("select public.apply_billing_event($1::jsonb)", [
    JSON.stringify({
      provider: "trial",
      event_id: `trial:${s.id}`,
      event_type: "trial.started",
      occurred_at: now.toISOString(),
      payload: { student_id: s.id },
      subscription: {
        student_id: s.id,
        plan: "nigeria_weekly",
        currency: "NGN",
        status: "trialing",
        trial_end: trialEnd,
        current_period_end: trialEnd,
      },
    }),
  ]);
}
await db.query("insert into public.encouragements (student_id, message) values ($1, $2)", [
  E2E_STUDENTS.junior.id,
  "Proud of you! Mummy",
]);

const [reviewer] = (
  await db.query<{ id: string }>("insert into auth.users default values returning id")
).rows;
await db.query("insert into public.profiles (id, role) values ($1, 'reviewer')", [reviewer!.id]);
const QUESTIONS = {
  english: {
    topic: "Concord",
    items: [
      [
        "Choose the correct verb: Each of the boys ___ a book.",
        ["has", "have", "are having", "were having"],
      ],
      [
        "Choose the correct verb: Neither Ada nor her friends ___ here.",
        ["are", "is", "was", "be"],
      ],
      ["Choose the correct pronoun: Between you and ___.", ["me", "I", "myself", "mine"]],
    ],
  },
  mathematics: {
    topic: "Algebra",
    items: [
      ["Solve for x: 2x + 3 = 11", ["4", "7", "5", "8"]],
      ["Simplify: 3(a + 2) − a", ["2a + 6", "4a + 6", "2a + 2", "3a + 6"]],
      ["If y = 2x and x = 5, what is y?", ["10", "7", "25", "2.5"]],
    ],
  },
} as const;
for (const [subject, { topic, items }] of Object.entries(QUESTIONS)) {
  const [t] = (
    await db.query<{ id: string }>(
      "insert into public.topics (subject, name) values ($1, $2) returning id",
      [subject, topic],
    )
  ).rows;
  for (const [stem, options] of items) {
    await db.query(
      `insert into public.questions (subject, topic_id, stem, options, answer_index, explanation_en, explanation_pcm, status, approved_by, approved_at)
       values ($1, $2, $3, $4::jsonb, 0, $5, $6, 'approved', $7, now())`,
      [
        subject,
        t!.id,
        stem,
        JSON.stringify(options),
        `The answer is "${options[0]}". Work it through step by step and check your answer.`,
        `Di answer na "${options[0]}". Do am step by step, then check am well.`,
        reviewer!.id,
      ],
    );
  }
}
await db.query("insert into public.settings (key, value) values ('questions_per_day', '5')");

const server = new PGLiteSocketServer({
  db,
  port: E2E_DB_PORT,
  host: "127.0.0.1",
  maxConnections: 10,
});
await server.start();
console.log(`e2e database ready on 127.0.0.1:${E2E_DB_PORT}`);

const stop = async () => {
  await server.stop();
  await db.close();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
