import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { buildDailySet } from "@/lib/engine";
import type { DraftQuestion, QuestionDrafter } from "@/lib/bank/llm";
import { QuestionInputSchema } from "@/lib/bank/rules";
import {
  bankHealth,
  BankError,
  draftQuestions,
  exportCsv,
  importCsv,
  listQuestions,
  reviewerWeeklyCounts,
  reviewQuestion,
  reviewQueue,
  saveQuestion,
  saveTopic,
  staffMember,
  type Staff,
} from "@/lib/bank/service";
import { startFreeTrial } from "@/lib/payments/trial";
import { addDays } from "@/lib/rules/days";
import { createStudent, createTestDb, createUser } from "./db/harness";
import { createPgBillingStore } from "./db/pg-store";
import { pgliteSql } from "./db/sql-pglite";

// The question bank's "Done when": a reviewer can approve AI drafts, only approved questions
// ever appear in buildDailySet, and the bank page shows runway per subject.

let db: PGlite;
let sql: ReturnType<typeof pgliteSql>;
let admin: Staff;
let reviewer: Staff;
let student: string;
let algebra: string;
const NOW = new Date("2026-10-05T08:00:00Z");

/** A stand-in for the LLM: `n` well-formed drafts. */
function fakeDrafter(n = 10): QuestionDrafter & { requests: unknown[] } {
  const requests: unknown[] = [];
  return {
    requests,
    async draft(request) {
      requests.push(request);
      return Array.from({ length: n }, (_, i): DraftQuestion => ({
        stem: `AI draft ${i + 1}: solve 2x + ${i} = ${2 * (i + 3) + i}. What is x?`,
        options: [`${i + 3}`, `${i + 4}`, `${i + 5}`, `${i + 6}`],
        answer_index: 0,
        explanation_en: `Take ${i} from both sides, then halve: x = ${i + 3}.`,
        explanation_pcm: `Comot ${i} from both side, then divide by two: x na ${i + 3}.`,
      }));
    },
  };
}

const ids = async (status?: string) => (await listQuestions(sql, { status })).map((q) => q.id);

beforeAll(async () => {
  db = await createTestDb();
  sql = pgliteSql(db);
  admin = await staffMember(sql, await createUser(db, "admin"));
  reviewer = await staffMember(sql, await createUser(db, "reviewer"));
  const parent = await createUser(db);
  student = await createStudent(db, parent, { firstName: "Ada" });
  await startFreeTrial(createPgBillingStore(db), student, NOW);
  algebra = await saveTopic(sql, admin, {
    subject: "mathematics",
    name: "Algebra",
    jambRef: "JAMB Mathematics: Algebra 2 (linear equations)",
    waecRef: "WAEC Mathematics: Algebraic processes",
  });
});

describe("the syllabus", () => {
  it("maps topics to the JAMB and WAEC syllabus; only admins change it", async () => {
    await saveTopic(sql, admin, {
      subject: "english",
      name: "Concord",
      jambRef: null,
      waecRef: "WAEC English: Lexis and structure",
    });
    await expect(
      saveTopic(sql, reviewer, {
        subject: "english",
        name: "Oral English",
        jambRef: null,
        waecRef: null,
      }),
    ).rejects.toThrow(/Only admins/);
    await expect(
      saveTopic(sql, admin, {
        subject: "mathematics",
        name: "algebra",
        jambRef: null,
        waecRef: null,
      }),
    ).rejects.toThrow(/already a topic/);
    const payer = await createUser(db);
    await expect(staffMember(sql, payer)).rejects.toThrow(BankError);
  });
});

describe("AI drafts", () => {
  it("are saved as draft, source ai_draft, and never reach a student", async () => {
    const drafter = fakeDrafter();
    expect(await draftQuestions(sql, admin, drafter, algebra)).toEqual({ created: 10 });
    expect(drafter.requests[0]).toMatchObject({
      subject: "mathematics",
      topic: "Algebra",
      jambRef: "JAMB Mathematics: Algebra 2 (linear equations)",
      count: 10,
    });
    const drafts = await listQuestions(sql, { status: "draft" });
    expect(drafts).toHaveLength(10);
    expect(new Set(drafts.map((d) => d.source))).toEqual(new Set(["ai_draft"]));
    expect((await reviewQueue(sql)).map((q) => q.id).sort()).toEqual(
      drafts.map((d) => d.id).sort(),
    );
    // Not one of them can be picked for a set, or answered.
    expect((await buildDailySet(sql, student, "2026-10-05")).picks).toEqual([]);
  });

  it("need the answer and the explanation confirmed before approval, by the app and the database", async () => {
    const [first] = await listQuestions(sql, { status: "draft" });
    await expect(
      reviewQuestion(sql, reviewer, first!.id, {
        action: "approve",
        answerChecked: true,
        explanationChecked: false,
        originalConfirmed: true,
      }),
    ).rejects.toThrow(/confirm both the answer and the explanation/);
    await expect(
      reviewQuestion(sql, reviewer, first!.id, {
        action: "approve",
        answerChecked: true,
        explanationChecked: true,
        originalConfirmed: false,
      }),
    ).rejects.toThrow(/original question/);
    // Even a direct database write can't approve an unchecked AI draft.
    await expect(
      db.query(
        "update public.questions set status = 'approved', original_confirmed = true, approved_by = $2, approved_at = now() where id = $1",
        [first!.id, reviewer.id],
      ),
    ).rejects.toThrow(/approved_ai_draft_checked/);
  });
});

describe("the review queue", () => {
  it("lets a reviewer approve, edit and approve, or reject with a reason", async () => {
    const drafts = await listQuestions(sql, { status: "draft" });
    for (const d of drafts.slice(0, 6)) {
      await reviewQuestion(sql, reviewer, d.id, {
        action: "approve",
        answerChecked: true,
        explanationChecked: true,
        originalConfirmed: true,
      });
    }
    // Edit and approve: the reviewer fixes the wording first.
    const edit = drafts[6]!;
    const input = QuestionInputSchema.parse({
      topicId: algebra,
      stem: `${edit.stem} (Show your working.)`,
      options: edit.options,
      answerIndex: edit.answer_index,
      explanationEn: edit.explanation_en,
      explanationPcm: edit.explanation_pcm ?? "",
      classes: ["SS1", "SS2"],
      syllabusRef: "",
      originalConfirmed: true,
    });
    await expect(
      saveQuestion(sql, reviewer, input, { id: edit.id, mode: "approve" }),
    ).rejects.toThrow(/confirm both/);
    await saveQuestion(sql, reviewer, input, {
      id: edit.id,
      mode: "approve",
      checks: { answer: true, explanation: true },
    });
    for (const d of drafts.slice(7, 9)) {
      await expect(
        reviewQuestion(sql, reviewer, d.id, { action: "reject", reason: "" }),
      ).rejects.toThrow(/reason/);
      await reviewQuestion(sql, reviewer, d.id, {
        action: "reject",
        reason: "Two options are correct.",
      });
    }
    expect(await ids("approved")).toHaveLength(7);
    expect(await ids("rejected")).toHaveLength(2);
    expect(await ids("draft")).toHaveLength(1);
    const edited = (await listQuestions(sql, { status: "approved" })).find(
      (q) => q.id === edit.id,
    )!;
    expect(edited).toMatchObject({ classes: ["SS1", "SS2"], reviewer_email: null });
    expect(edited.stem).toContain("Show your working");
  });

  it("records who reviewed what, with weekly counts per reviewer", async () => {
    const weeks = await reviewerWeeklyCounts(sql, new Date());
    expect(weeks).toEqual([
      expect.objectContaining({
        reviewer_id: reviewer.id,
        approved: 6,
        edited: 1,
        rejected: 2,
        total: 9,
      }),
    ]);
    const { rows } = await db.query<{ n: number }>(
      "select count(*)::int as n from public.audit_log where actor_id = $1 and entity_type = 'question'",
      [reviewer.id],
    );
    expect(rows[0]!.n).toBe(9);
  });
});

describe("only approved questions reach students", () => {
  it("buildDailySet picks only approved, unflagged questions, day after day", async () => {
    const approved = new Set(await ids("approved"));
    const asked = new Set<string>();
    for (let d = 0; d < 20; d++) {
      const plan = await buildDailySet(sql, student, addDays("2026-10-05", d));
      for (const p of plan.picks) {
        expect(approved.has(p.questionId)).toBe(true);
        asked.add(p.questionId);
      }
    }
    expect(asked.size).toBe(approved.size);
  });

  it("drops a question flagged for re-checking until a reviewer clears it", async () => {
    const [flag] = await ids("approved");
    await reviewQuestion(sql, reviewer, flag!, {
      action: "flag",
      reason: "Students keep choosing B.",
    });
    const plan = await buildDailySet(sql, student, "2026-11-01", { size: 20 });
    expect(plan.picks.map((p) => p.questionId)).not.toContain(flag);
    expect((await reviewQueue(sql))[0]!.id).toBe(flag); // flags come first in the queue
    await reviewQuestion(sql, reviewer, flag!, { action: "clear" });
    const after = await buildDailySet(sql, student, "2026-11-01", { size: 20 });
    expect(after.picks.map((p) => p.questionId)).toContain(flag);
  });
});

describe("CSV", () => {
  it("exports the bank and imports questions as drafts for review, never approved", async () => {
    const csv = await exportCsv(sql, { status: "approved" });
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe(
      "id,subject,topic,stem,option_a,option_b,option_c,option_d,option_e,answer,explanation_en,explanation_pcm,classes,syllabus_ref,original,status,source",
    );
    expect(lines).toHaveLength(8);
    const result = await importCsv(
      sql,
      admin,
      `${csv}x,mathematics,No such topic,What is 1 + 1?,1,2,,,,B,One and one make two.,,SS1,,yes,approved,human\r\n` +
        `y,chemistry,Algebra,What is 1 + 1?,1,2,,,,B,Because.,,SS1,,yes,approved,human\r\n`,
    );
    expect(result.created).toBe(7);
    expect(result.errors).toEqual([
      { line: 9, message: 'No mathematics topic called "No such topic".' },
      { line: 10, message: 'Unknown subject "chemistry".' },
    ]);
    const imported = (await listQuestions(sql)).filter((q) => q.source === "import");
    expect(imported).toHaveLength(7);
    expect(new Set(imported.map((q) => q.status))).toEqual(new Set(["draft"]));
  });
});

describe("bank health", () => {
  it("shows approved counts, runway per subject, thin topics, shortages and re-check flags", async () => {
    const health = await bankHealth(sql, NOW);
    expect(health.subjects.map((s) => s.subject)).toEqual([
      "english",
      "mathematics",
      "physics",
      "biology",
    ]);
    // Ada takes English and Mathematics: 10 a day, 80% fresh, over 2 subjects = 4 maths a day.
    // She has answered none yet, so 7 fresh maths questions last 1 day.
    expect(health.subjects.find((s) => s.subject === "mathematics")).toEqual({
      subject: "mathematics",
      approved: 7,
      runway: 1,
    });
    expect(health.subjects.find((s) => s.subject === "english")).toMatchObject({
      approved: 0,
      runway: 0,
    });
    expect(health.topics.find((t) => t.name === "Algebra")).toMatchObject({
      approved: 7,
      waiting: 8,
      rejected: 2,
      low: true, // under 10 approved
    });
    // Ada's sets of 10 couldn't be filled from 7 maths questions: the engine logged it.
    expect(health.shortages).toEqual([
      expect.objectContaining({ subject: "mathematics", topic: "Algebra", students: 1 }),
    ]);
    expect(health.recheck).toEqual([]);
  });

  it("flags questions students get wrong unusually often, with the option they pick instead", async () => {
    const approved = await listQuestions(sql, { status: "approved" });
    const [bad, ...good] = approved;
    const { rows: session } = await db.query<{ id: string }>(
      `insert into public.practice_sessions (student_id, channel, lagos_day, question_ids)
       values ($1, 'web', '2026-09-01', '{}') returning id::text`,
      [student],
    );
    // 12 answers each from 12 sessions' worth of students is too slow to set up; fake the counts
    // with one student's answers across many sessions instead.
    for (let i = 0; i < 12; i++) {
      const { rows: s } = await db.query<{ id: string }>(
        `insert into public.practice_sessions (student_id, channel, lagos_day, question_ids)
         values ($1, 'web', $2, '{}') returning id::text`,
        [student, addDays("2026-08-01", i)],
      );
      await db.query(
        `insert into public.answers (session_id, student_id, question_id, chosen_index, correct)
         values ($1, $2, $3, $4, $5)`,
        [s[0]!.id, student, bad!.id, i < 2 ? 0 : 1, i < 2],
      );
      for (const g of good.slice(0, 2)) {
        await db.query(
          `insert into public.answers (session_id, student_id, question_id, chosen_index, correct)
           values ($1, $2, $3, $4, $5)`,
          [s[0]!.id, student, g.id, i < 9 ? 0 : 2, i < 9],
        );
      }
    }
    void session;
    const health = await bankHealth(sql, NOW);
    expect(health.recheck).toEqual([
      expect.objectContaining({
        id: bad!.id,
        attempts: 12,
        rate: 17,
        topicRate: 75,
        popularWrong: { index: 1, share: 83 },
        topic: "Algebra",
        flagged: false,
      }),
    ]);
  });

  it("lists recent bank shortages per topic, newest first, last two weeks only", async () => {
    const [concord] = (
      await db.query<{ id: string }>("select id::text from public.topics where name = 'Concord'")
    ).rows;
    for (const day of ["2026-10-04", "2026-09-01"]) {
      await db.query(
        `insert into public.engine_events (kind, student_id, subject, topic_id, lagos_day)
         values ('bank_shortage', $1, 'english', $2, $3)`,
        [student, concord!.id, day],
      );
    }
    const health = await bankHealth(sql, NOW);
    expect(health.shortages.find((s) => s.topic === "Concord")).toEqual({
      subject: "english",
      topic: "Concord",
      students: 1,
      days: 1, // 1 September is more than two weeks ago
      last_day: "2026-10-04",
    });
  });
});
