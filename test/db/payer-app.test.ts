import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { STREAK_DAY_THRESHOLD } from "@/config/pilot";
import { getStudentAccess, isStudentActive } from "@/lib/access";
import { startFreeTrial } from "@/lib/payments/trial";
import { asUser, createGroup, createStudent, createTestDb, createUser } from "./harness";
import { createPgBillingStore } from "./pg-store";

let db: PGlite;
let store: ReturnType<typeof createPgBillingStore>;

beforeAll(async () => {
  db = await createTestDb();
  store = createPgBillingStore(db);
});

/** One approved question in a fresh topic. */
async function approvedQuestion(status: "approved" | "draft" = "approved"): Promise<string> {
  const reviewer = await createUser(db, "reviewer");
  const { rows: topic } = await db.query<{ id: string }>(
    "insert into public.topics (subject, name) values ('physics', $1) returning id",
    [`Topic ${randomUUID().slice(0, 8)}`],
  );
  const { rows } = await db.query<{ id: string }>(
    `insert into public.questions (subject, topic_id, stem, options, answer_index, explanation_en, status, approved_by, approved_at)
     values ('physics', $1, 'What is the SI unit of force?', '["Newton","Joule","Watt","Pascal"]', 0, 'Force is measured in newtons.',
             $2::text::public.question_status,
             case when $2::text = 'approved' then $3::uuid end, case when $2::text = 'approved' then now() end)
     returning id`,
    [topic[0]!.id, status, reviewer],
  );
  return rows[0]!.id;
}

async function answer(studentId: string, questionId: string, at = new Date()) {
  const { rows } = await db.query<{ id: string }>(
    "insert into public.practice_sessions (student_id, channel, started_at) values ($1, 'whatsapp', $2) returning id",
    [studentId, at.toISOString()],
  );
  await db.query(
    "insert into public.answers (session_id, student_id, question_id, chosen_index, correct, answered_at) values ($1, $2, $3, 0, true, $4)",
    [rows[0]!.id, studentId, questionId, at.toISOString()],
  );
}

describe("questions and answers", () => {
  it("only lets approved questions be answered", async () => {
    const owner = await createUser(db);
    const student = await createStudent(db, owner);
    await expect(answer(student, await approvedQuestion("draft"))).rejects.toThrow(/approved/);
    await expect(answer(student, await approvedQuestion())).resolves.toBeUndefined();
  });

  it("requires a teacher's approval on record for an approved question", async () => {
    const { rows } = await db.query<{ id: string }>(
      "insert into public.topics (subject, name) values ('english', 'Concord') returning id",
    );
    await expect(
      db.query(
        `insert into public.questions (subject, topic_id, stem, options, answer_index, explanation_en, status)
         values ('english', $1, 'Choose the right verb.', '["is","are"]', 0, 'Singular subject.', 'approved')`,
        [rows[0]!.id],
      ),
    ).rejects.toThrow(/approved_by_a_teacher/);
  });

  it("keeps a question's topic in the same subject", async () => {
    const { rows } = await db.query<{ id: string }>(
      "insert into public.topics (subject, name) values ('biology', 'Cells') returning id",
    );
    await expect(
      db.query(
        `insert into public.questions (subject, topic_id, stem, options, answer_index, explanation_en)
         values ('physics', $1, 'Mismatched topic here', '["a","b"]', 0, 'x')`,
        [rows[0]!.id],
      ),
    ).rejects.toThrow(/foreign key/);
  });
});

describe("co-sponsors (viewers)", () => {
  it("can see the child and their progress, but not billing, and can't change anything", async () => {
    const owner = await createUser(db);
    const viewer = await createUser(db);
    const stranger = await createUser(db);
    const student = await createStudent(db, owner, { firstName: "Tolu" });
    await answer(student, await approvedQuestion());
    await db.query(
      `insert into public.subscriptions (provider, provider_subscription_id, student_id, plan, currency, status)
       values ('stripe', $1, $2, 'abroad_monthly', 'GBP', 'active')`,
      [`sub_${randomUUID()}`, student],
    );
    await db.query(
      "insert into public.student_viewers (student_id, viewer_id, invited_by) values ($1, $2, $3)",
      [student, viewer, owner],
    );

    const look = (userId: string) =>
      asUser(db, userId, async (tx) => ({
        students: (await tx.query("select id from public.students where id = $1", [student])).rows
          .length,
        history: (
          await tx.query("select * from public.student_answer_history($1, '2000-01-01')", [student])
        ).rows.length,
        subscriptions: (
          await tx.query("select id from public.subscriptions where student_id = $1", [student])
        ).rows.length,
      }));
    expect(await look(viewer)).toEqual({ students: 1, history: 1, subscriptions: 0 });
    expect(await look(stranger)).toEqual({ students: 0, history: 0, subscriptions: 0 });
    expect(await look(owner)).toEqual({ students: 1, history: 1, subscriptions: 1 });

    await expect(
      asUser(db, viewer, (tx) =>
        tx.query("update public.students set first_name = 'X' where id = $1", [student]),
      ),
    ).resolves.toMatchObject({ affectedRows: 0 });
  });
});

describe("class leaderboard", () => {
  it("shows the owner's class only, with first name and initial", async () => {
    const buyer = await createUser(db, "group_buyer");
    const other = await createUser(db, "group_buyer");
    const group = await createGroup(db, buyer);
    const busy = await createStudent(db, buyer, { firstName: "Chika", groupId: group });
    await createStudent(db, buyer, { firstName: "Dayo", groupId: group });
    const question = await approvedQuestion();
    const day = new Date();
    for (let i = 0; i < STREAK_DAY_THRESHOLD; i++) {
      const { rows } = await db.query<{ id: string }>(
        "insert into public.practice_sessions (student_id, channel) values ($1, 'web') returning id",
        [busy],
      );
      await db.query(
        "insert into public.answers (session_id, student_id, question_id, chosen_index, correct, answered_at) values ($1, $2, $3, 0, $4, $5)",
        [rows[0]!.id, busy, question, i % 2 === 0, day.toISOString()],
      );
    }
    const stats = (userId: string) =>
      asUser(
        db,
        userId,
        async (tx) =>
          (
            await tx.query(
              "select * from public.group_week_stats($1, '2000-01-01', $2) order by first_name",
              [group, STREAK_DAY_THRESHOLD],
            )
          ).rows,
      );
    const rows = await stats(buyer);
    expect(rows).toEqual([
      expect.objectContaining({
        first_name: "Chika",
        last_initial: "O",
        answered: 5,
        correct: 3,
        practice_days: 1,
      }),
      expect.objectContaining({ first_name: "Dayo", answered: 0, practice_days: 0 }),
    ]);
    expect(Object.keys(rows[0]!)).not.toContain("whatsapp_number");
    expect(await stats(other)).toEqual([]);
  });
});

describe("access gate", () => {
  it("keeps a child inactive without guardian consent, even when paid", async () => {
    const owner = await createUser(db);
    const student = await createStudent(db, owner, { consent: false });
    await startFreeTrial(store, student);
    expect(await getStudentAccess(student, { store })).toEqual({
      state: "inactive",
      until: null,
      awaitingConsent: true,
    });
    await db.query(
      `insert into public.guardian_consents (student_id, event, method, consent_text_version) values ($1, 'granted', 'guardian_link', 'v1')`,
      [student],
    );
    expect(await isStudentActive(student, { store })).toBe(true);
  });

  it("treats withdrawn consent as no consent", async () => {
    const owner = await createUser(db);
    const student = await createStudent(db, owner);
    await startFreeTrial(store, student);
    await db.query(
      `insert into public.guardian_consents (student_id, event, method, consent_text_version, created_at)
       values ($1, 'withdrawn', 'web_checkbox', 'v1', now() + interval '1 second')`,
      [student],
    );
    expect(await isStudentActive(student, { store })).toBe(false);
  });

  it("gives one 7-day free trial per student, ending without grace", async () => {
    const owner = await createUser(db);
    const student = await createStudent(db, owner);
    const start = new Date("2026-10-01T10:00:00Z");
    expect(await startFreeTrial(store, student, start)).toBe("applied");
    expect(await startFreeTrial(store, student, new Date("2026-10-20T10:00:00Z"))).toBe(
      "duplicate",
    );
    expect(await store.hasAnySubscription(student)).toBe(true);
    const end = new Date("2026-10-08T10:00:00Z");
    expect(
      await getStudentAccess(student, { store, now: new Date("2026-10-07T00:00:00Z") }),
    ).toEqual({ state: "active", until: end });
    expect(await isStudentActive(student, { store, now: new Date(end.getTime() + 60_000) })).toBe(
      false,
    );
  });
});

describe("webhooks after a child's data is deleted", () => {
  it("records the event and payment but recreates nothing", async () => {
    const owner = await createUser(db);
    const student = await createStudent(db, owner);
    await db.query("delete from public.students where id = $1", [student]);
    const result = await store.applyBillingEvent({
      provider: "stripe",
      event_id: `evt_${randomUUID()}`,
      event_type: "invoice.paid",
      occurred_at: new Date().toISOString(),
      subscription: {
        provider_subscription_id: `sub_${randomUUID()}`,
        student_id: student,
        plan: "abroad_monthly",
        currency: "GBP",
        status: "active",
      },
      payment: {
        provider_payment_id: `in_${randomUUID()}`,
        status: "succeeded",
        amount_minor: 600,
        currency: "GBP",
      },
    });
    expect(result).toBe("applied");
    const { rows } = await db.query("select 1 from public.subscriptions where student_id = $1", [
      student,
    ]);
    expect(rows).toEqual([]);
  });
});
