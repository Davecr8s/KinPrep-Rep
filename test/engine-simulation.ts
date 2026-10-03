import type { PGlite } from "@electric-sql/pglite";
import type { Subject } from "@/config/pilot";
import { bankRunway } from "@/lib/engine";
import { advanceSet, markAnswer, startOrResumeSet } from "@/lib/engine/session";
import { recordManualPayment } from "@/lib/payments/manual";
import { getQuestion, practiceStudent } from "@/lib/practice/repo";
import { addDays, lagosDayStart } from "@/lib/rules/days";
import { createStudent, createTestDb, createUser } from "./db/harness";
import { createPgBillingStore } from "./db/pg-store";
import { pgliteSql } from "./db/sql-pglite";

// 30 days of one student practising through the real engine on the real schema (PGlite): every
// day's set is built by buildDailySet, every answer goes through markAnswer and recordAttempt.
// Run it with `npm run simulate:engine` to print the table; test/engine-simulation.test.ts
// checks the same run.

export const SIM_START = "2026-10-05"; // a Monday
export const SIM_DAYS = 30;
export const PER_SUBJECT = 75;
const TOPICS_PER_SUBJECT = 5;
const SUBJECTS: Subject[] = ["english", "mathematics"];

/** How likely the simulated student is to get each topic right (topics 1-5 of each subject). */
const SKILL: Record<string, number[]> = {
  english: [0.9, 0.75, 0.6, 0.45, 0.8],
  mathematics: [0.85, 0.5, 0.7, 0.35, 0.9],
};

/** A small seeded random number generator (mulberry32), so every run is the same. */
function seeded(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type SimDay = {
  day: string;
  asked: number;
  review: number;
  weak: number;
  new: number;
  fill: number;
  topup: number;
  /** Questions asked as fresh (weak, new or fill) that the student had answered before. */
  freshRepeats: number;
  /** Review picks the student had never got wrong (should never happen). */
  badReviews: number;
  correct: number;
  /** Never-answered questions left for this student after the day. */
  freshLeft: number;
  runway: Record<Subject, number>;
  shortagesLogged: number;
};

export type SimResult = {
  days: SimDay[];
  /** Questions for juniors only, which this SS2 student must never be asked. */
  juniorOnlyAsked: number;
  totalShortageEvents: number;
  db: PGlite;
};

export async function simulate(): Promise<SimResult> {
  const db = await createTestDb();
  const sql = pgliteSql(db);
  const parent = await createUser(db);
  const admin = await createUser(db, "admin");
  const studentId = await createStudent(db, parent, { firstName: "Sim" });
  await db.query("update public.students set subjects = $2::public.subject[] where id = $1", [
    studentId,
    `{${SUBJECTS.join(",")}}`,
  ]);
  await recordManualPayment(
    createPgBillingStore(db),
    {
      target: { kind: "student", studentId },
      planId: "nigeria_monthly",
      currency: "NGN",
      amountMinor: 200_000,
      periodStart: lagosDayStart(SIM_START),
      periodEnd: lagosDayStart(addDays(SIM_START, 40)),
      paidAt: lagosDayStart(SIM_START),
      bankReference: "SIM-30-DAYS",
    },
    admin,
  );

  // The bank: 75 approved questions per subject, 15 in each of 5 topics; plus 10 English
  // questions marked for junior classes only, which an SS2 student must never see.
  const reviewer = await createUser(db, "reviewer");
  const topicSkill = new Map<string, number>();
  // Fixed ids, so the engine's tie-breaks (and the printed table) are the same on every run.
  let serial = 0;
  const fixedId = () => `00000000-0000-4000-8000-${(++serial).toString(16).padStart(12, "0")}`;
  for (const subject of SUBJECTS) {
    for (let t = 0; t < TOPICS_PER_SUBJECT; t++) {
      const { rows } = await db.query<{ id: string }>(
        "insert into public.topics (id, subject, name) values ($1, $2, $3) returning id::text",
        [fixedId(), subject, `${subject} topic ${t + 1}`],
      );
      const topicId = rows[0]!.id;
      topicSkill.set(topicId, SKILL[subject]![t]!);
      const per = PER_SUBJECT / TOPICS_PER_SUBJECT;
      for (let q = 0; q < per + (subject === "english" && t === 0 ? 10 : 0); q++) {
        const juniorOnly = q >= per;
        await db.query(
          `insert into public.questions (id, subject, topic_id, stem, options, answer_index, explanation_en, status, approved_by, approved_at, original_confirmed, classes)
           values ($6, $1, $2, $3, '["right","wrong 1","wrong 2","wrong 3"]', 0, 'Because.', 'approved', $4, now(), true, $5)`,
          [
            subject,
            topicId,
            `${subject} topic ${t + 1}, question ${q + 1}${juniorOnly ? " (JSS)" : ""}`,
            reviewer,
            juniorOnly ? "{JSS1,JSS2}" : "{SS1,SS2,SS3,UTME}",
            fixedId(),
          ],
        );
      }
    }
  }

  const student = (await practiceStudent(sql, studentId))!;
  const random = seeded(42);
  const answeredBefore = new Set<string>();
  const gotWrong = new Set<string>();
  const days: SimDay[] = [];

  for (let d = 0; d < SIM_DAYS; d++) {
    const day = addDays(SIM_START, d);
    const morning = new Date(lagosDayStart(day).getTime() + 8 * 3600_000);
    const runway = {
      english: await bankRunway(sql, "english", morning),
      mathematics: await bankRunway(sql, "mathematics", morning),
    } as Record<Subject, number>;

    const set = await startOrResumeSet(sql, student, "web", day, morning);
    if (set.kind === "noQuestions") throw new Error(`No questions on ${day}`);
    const [row] = await sql.query<{ pick_reasons: string[] }>(
      "select pick_reasons from public.practice_sessions where id = $1",
      [set.session.id],
    );
    const reasons = row!.pick_reasons;
    const today: SimDay = {
      day,
      asked: reasons.length,
      review: 0,
      weak: 0,
      new: 0,
      fill: 0,
      topup: 0,
      freshRepeats: 0,
      badReviews: 0,
      correct: 0,
      freshLeft: 0,
      runway,
      shortagesLogged: 0,
    };

    let session = set.session;
    for (let position = 0; position < session.question_ids.length; position++) {
      const questionId = session.question_ids[position]!;
      const reason = reasons[position] as keyof Pick<
        SimDay,
        "review" | "weak" | "new" | "fill" | "topup"
      >;
      today[reason] += 1;
      if (["weak", "new", "fill"].includes(reason) && answeredBefore.has(questionId)) {
        today.freshRepeats += 1;
      }
      if (reason === "review" && !gotWrong.has(questionId)) today.badReviews += 1;

      const question = await getQuestion(sql, questionId);
      const correct = random() < topicSkill.get(await topicOf(questionId))!;
      const at = new Date(morning.getTime() + position * 60_000);
      await markAnswer(sql, {
        session,
        studentId,
        position,
        option: correct ? question.answer_index : (question.answer_index + 1) % 4,
        now: at,
      });
      answeredBefore.add(questionId);
      if (!correct) gotWrong.add(questionId);
      if (correct) today.correct += 1;
      const moved = await advanceSet(sql, { ...session, awaiting: "next", position }, position, at);
      if (moved.kind === "question") session = moved.session;
    }

    const [left] = await sql.query<{ n: number }>(
      `select count(*)::int as n from public.questions q
       where q.status = 'approved' and 'SS2' = any(q.classes::text[])
         and not exists (select 1 from public.answers a where a.student_id = $1 and a.question_id = q.id)`,
      [studentId],
    );
    today.freshLeft = left!.n;
    const [logged] = await sql.query<{ n: number }>(
      "select count(*)::int as n from public.engine_events where kind = 'bank_shortage' and lagos_day = $1",
      [day],
    );
    today.shortagesLogged = logged!.n;
    days.push(today);
  }

  const [junior] = await sql.query<{ n: number }>(
    `select count(*)::int as n from public.answers a join public.questions q on q.id = a.question_id
     where not ('SS2' = any(q.classes::text[]))`,
  );
  const [events] = await sql.query<{ n: number }>(
    "select count(*)::int as n from public.engine_events where kind = 'bank_shortage'",
  );
  return { days, juniorOnlyAsked: junior!.n, totalShortageEvents: events!.n, db };

  async function topicOf(questionId: string): Promise<string> {
    const [q] = await sql.query<{ topic_id: string }>(
      "select topic_id::text from public.questions where id = $1",
      [questionId],
    );
    return q!.topic_id;
  }
}

export function formatSimulation(result: SimResult): string {
  const header =
    "Day         Set  Review Weak New Fill Topup  FreshRepeats  Correct  FreshLeft  Runway(en/ma)  Shortages";
  const lines = result.days.map((d) =>
    [
      d.day,
      String(d.asked).padStart(4),
      String(d.review).padStart(7),
      String(d.weak).padStart(4),
      String(d.new).padStart(3),
      String(d.fill).padStart(4),
      String(d.topup).padStart(5),
      String(d.freshRepeats).padStart(13),
      String(d.correct).padStart(8),
      String(d.freshLeft).padStart(10),
      `${d.runway.english}/${d.runway.mathematics}`.padStart(14),
      String(d.shortagesLogged).padStart(10),
    ].join(" "),
  );
  const firstTopup = result.days.find((d) => d.topup > 0);
  const summary = [
    "",
    `Bank: ${PER_SUBJECT} questions per subject (English, Mathematics), ${SIM_DAYS} days, 10 a day.`,
    `Fresh repeats before the bank ran out: ${result.days
      .filter((d) => !firstTopup || d.day < firstTopup.day)
      .reduce((n, d) => n + d.freshRepeats, 0)}`,
    firstTopup
      ? `Bank ran out on ${firstTopup.day}: from then on, review mode (top-ups) with ${result.totalShortageEvents} bank_shortage events logged.`
      : "The bank never ran out.",
    `Junior-only questions asked to this SS2 student: ${result.juniorOnlyAsked}`,
  ];
  return [header, ...lines, ...summary].join("\n");
}
