import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { startFreeTrial } from "@/lib/payments/trial";
import { todaysLinks } from "@/lib/practice/daily-links";
import { signPracticeLink, verifyPracticeLink } from "@/lib/practice/links";
import { practiceGet, practicePost } from "@/lib/practice/web";
import { lagosDay, weekStart } from "@/lib/rules/days";
import { currentStreak, weekDots, weeklyReport, type AnswerRow } from "@/lib/rules/progress";
import { asUser, createStudent, createTestDb, createUser, JUNIOR_BIRTH_YEAR } from "./db/harness";
import { createPgBillingStore } from "./db/pg-store";
import { pgliteSql } from "./db/sql-pglite";

// The web practice page's "Done when", through the real handlers on the real schema: a junior and
// a senior each complete a set, answers survive a reload, and the payer dashboard's own query
// (student_answer_history, as the signed-in payer) sees the web attempts.

const APP = "https://kinprep.test";
const SECRET = "test-practice-link-secret-0123456789";
const PER_DAY = 5;

let db: PGlite;
let sql: ReturnType<typeof pgliteSql>;
let parent: string;
let kemi: string; // junior
let tunde: string; // senior
let ife: string; // senior, for the reload test
let clock = Date.parse("2026-10-05T08:00:00Z"); // a Monday morning in Lagos
const now = () => new Date(clock);
const deps = () => ({ sql, secret: SECRET, appUrl: APP, now: now() });
const linkFor = (studentId: string, at = now()) =>
  signPracticeLink({ studentId, issuedAt: at }, SECRET);

beforeAll(async () => {
  db = await createTestDb();
  sql = pgliteSql(db);
  const store = createPgBillingStore(db);
  parent = await createUser(db);
  await db.query("update auth.users set email = 'parent@example.com' where id = $1", [parent]);
  await db.query("update public.payers set whatsapp_number = '+447700900123' where id = $1", [
    parent,
  ]);
  kemi = await createStudent(db, parent, { firstName: "Kemi", birthYear: JUNIOR_BIRTH_YEAR });
  await db.query("update public.students set class = 'JSS1', exam = 'BECE' where id = $1", [kemi]);
  tunde = await createStudent(db, parent, { firstName: "Tunde", whatsapp: "+2348020000001" });
  ife = await createStudent(db, parent, { firstName: "Ife" });
  for (const s of [kemi, tunde, ife]) await startFreeTrial(store, s, now());

  const reviewer = await createUser(db, "reviewer");
  for (const subject of ["english", "mathematics"]) {
    const { rows } = await db.query<{ id: string }>(
      "insert into public.topics (subject, name) values ($1, $2) returning id",
      [subject, subject === "english" ? "Concord" : "Algebra"],
    );
    for (let i = 0; i < 4; i++) {
      await db.query(
        `insert into public.questions (subject, topic_id, stem, options, answer_index, explanation_en, explanation_pcm, status, approved_by, approved_at)
         values ($1, $2, $3, $4::jsonb, 0, $5, $6, 'approved', $7, now())`,
        [
          subject,
          rows[0]!.id,
          `${subject} question ${i + 1}: which is right?`,
          JSON.stringify(["The correct answer", "A wrong answer", "Another wrong one", "Not this"]),
          `Because the first option is right (${subject} ${i + 1}).`,
          `Na di first one correct (${subject} ${i + 1}).`,
          reviewer,
        ],
      );
    }
  }
  await db.query("insert into public.settings (key, value) values ('questions_per_day', $1)", [
    String(PER_DAY),
  ]);
});

type Page = { status: number; html: string };

async function open(token: string, query = ""): Promise<Page> {
  clock += 2_000;
  const res = await practiceGet(token, new URL(`${APP}/p/${token}${query}`), deps());
  return { status: res.status, html: await res.text() };
}

/** A form tap: saved, then redirected back to the page (post/redirect/get), like the browser. */
async function tap(token: string, fields: Record<string, string>): Promise<Page> {
  clock += 2_000;
  const res = await practicePost(token, new URLSearchParams(fields), deps());
  expect(res.status).toBe(303);
  expect(res.headers.get("location")).toBe(`/p/${token}`);
  return open(token);
}

function forms(html: string): Record<string, string>[] {
  return [...html.matchAll(/<form method="post">(.*?)<\/form>/g)].map((m) =>
    Object.fromEntries(
      [...m[1]!.matchAll(/name="(\w+)" value="([^"]*)"/g)].map((f) => [f[1]!, f[2]!]),
    ),
  );
}
const answerForm = (html: string, option: number) =>
  forms(html).find((f) => f.action === "answer" && f.option === String(option)) ??
  expect.fail(`no option ${option} in:\n${html}`);
const nextForm = (html: string) =>
  forms(html).find((f) => f.action === "next") ?? expect.fail(`no Next in:\n${html}`);
const text = (html: string) =>
  html
    .replace(/<style>[\s\S]*?<\/style>|<script>[\s\S]*?<\/script>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");

/** Starts and completes today's set, choosing `choose(i)` for question i. Returns the summary. */
async function completeSet(token: string, choose: (i: number) => number): Promise<Page> {
  let page = await open(token);
  expect(text(page.html)).toContain(`Today's set has ${PER_DAY} questions`);
  page = await tap(token, { action: "start" });
  for (let i = 0; i < PER_DAY; i++) {
    expect(text(page.html)).toContain(`Question ${i + 1} of ${PER_DAY}`);
    page = await tap(token, answerForm(page.html, choose(i)));
    expect(text(page.html)).toMatch(/Correct!|Not quite/);
    page = await tap(token, nextForm(page.html));
  }
  return page;
}

async function sessions(studentId: string) {
  const { rows } = await db.query<{ channel: string; completed: boolean }>(
    "select channel::text, completed_at is not null as completed from public.practice_sessions where student_id = $1",
    [studentId],
  );
  return rows;
}

describe("a junior completes a set on a web page", () => {
  it("one question at a time, marking, explanations, summary and streak, no league", async () => {
    await db.query("insert into public.encouragements (student_id, message) values ($1, $2)", [
      kemi,
      "Proud of you, Kemi!",
    ]);
    const token = linkFor(kemi);
    const start = await open(token);
    expect(start.status).toBe(200);
    expect(text(start.html)).toContain("Hi Kemi!");
    expect(text(start.html)).toContain("Proud of you, Kemi!");
    // Only the first name: no last initial, class or anything else about the child.
    expect(start.html).not.toMatch(/Kemi O\b|JSS1|BECE/);

    let page = await tap(token, { action: "start" });
    page = await tap(token, answerForm(page.html, 0));
    expect(text(page.html)).toContain("✅ Correct!");
    expect(text(page.html)).toContain("Question 1 of 5"); // still question 1 until "Next"
    expect(text(page.html)).toContain("Because the first option is right");
    // "Explain another way": the teacher-written explanation in the other language (until Prompt 10).
    const alt = await open(token, "?alt=0");
    expect(text(alt.html)).toContain("Here it is in Pidgin");
    expect(text(alt.html)).toContain("Na di first one correct");
    page = await tap(token, nextForm(page.html));
    page = await tap(token, answerForm(page.html, 2));
    expect(text(page.html)).toContain("❌ Not quite. The answer is A.");
    expect(page.html).toContain("✗ Yours");
    page = await tap(token, nextForm(page.html));
    for (let i = 2; i < PER_DAY; i++) {
      page = await tap(token, answerForm(page.html, 0));
      page = await tap(token, nextForm(page.html));
    }

    const summary = text(page.html);
    expect(summary).toContain("Well done, Kemi!");
    expect(summary).toContain("4/5 Score");
    expect(summary).toContain("1 day streak"); // 5 answers make it a practice day
    expect(summary).toContain("hand the phone back");
    expect(summary).not.toMatch(/league/i); // no leagues with strangers
    expect(await sessions(kemi)).toEqual([{ channel: "web", completed: true }]);
    const { rows } = await db.query(
      "select 1 from public.encouragements where student_id = $1 and delivered_at is null",
      [kemi],
    );
    expect(rows).toHaveLength(0);

    // Coming back to the link shows the summary, not a second set.
    expect(text((await open(token)).html)).toContain("You finished today's set");
  });

  it("shows the attempts on the payer dashboard, from the payer's own query", async () => {
    const history = await asUser(db, parent, async (tx) =>
      (
        await tx.query<{
          answered_at: Date;
          correct: boolean;
          subject: string;
          topic: string;
          session_id: string;
        }>("select * from public.student_answer_history($1, '2000-01-01')", [kemi])
      ).rows.map((r): AnswerRow => ({
        answeredAt: new Date(r.answered_at),
        correct: r.correct,
        subject: r.subject as AnswerRow["subject"],
        topic: r.topic,
        sessionId: r.session_id,
      })),
    );
    const today = lagosDay(now());
    expect(history).toHaveLength(5);
    expect(weekDots(history, today).find((d) => d.today)?.practised).toBe(true);
    expect(currentStreak(history, today)).toBe(1);
    const report = weeklyReport(history, weekStart(today));
    expect(report).toMatchObject({ answered: 5, accuracy: 80, daysPractised: 1 });
  });
});

describe("a senior completes a set on the web (fallback)", () => {
  it("gets the same set experience, plus the class league without juniors", async () => {
    const page = await completeSet(linkFor(tunde), () => 0);
    const summary = text(page.html);
    expect(summary).toContain("Well done, Tunde!");
    expect(summary).toContain("5/5 Score");
    expect(summary).toContain("This week's league");
    expect(summary).toContain("You: 5 correct");
    expect(summary).not.toContain("Kemi"); // juniors never appear in a league with strangers
    expect(await sessions(tunde)).toEqual([{ channel: "web", completed: true }]);
  });
});

describe("a dropped connection loses nothing", () => {
  it("each answer is saved when given; a reload shows it; repeats change nothing", async () => {
    const token = linkFor(ife);
    let page = await tap(token, { action: "start" });
    const question = text(page.html);
    // Reload before answering: the same question.
    expect(question).toContain("Question 1 of 5");
    expect(text((await open(token)).html)).toBe(question);

    page = await tap(token, answerForm(page.html, 1));
    // Reload after answering: the answer is there, marked, with the explanation.
    const reloaded = await open(token);
    expect(text(reloaded.html)).toContain("❌ Not quite");
    expect(reloaded.html).toMatch(/opt wrong"><span class="l">B<\/span>/);

    // The same tap resent (no response seen), or a different option sent late: ignored.
    await tap(token, { action: "answer", position: "0", option: "1" });
    await tap(token, { action: "answer", position: "0", option: "0" });
    const answers = await db.query<{ chosen_index: number }>(
      "select chosen_index from public.answers where student_id = $1",
      [ife],
    );
    expect(answers.rows).toEqual([{ chosen_index: 1 }]);

    // "Next" resent twice moves on once, never skipping a question.
    await tap(token, nextForm(reloaded.html));
    page = await tap(token, nextForm(reloaded.html));
    expect(text(page.html)).toContain("Question 2 of 5");
    // The first answer's tap arriving again now (a retry from a dropped connection): ignored.
    page = await tap(token, { action: "answer", position: "0", option: "1" });
    expect(text(page.html)).toContain("Question 2 of 5");
    expect(page.html).toContain('name="action" value="answer"');
    // Rubbish or out-of-range fields are ignored.
    page = await tap(token, { action: "answer", position: "1", option: "7" });
    page = await tap(token, { action: "answer", position: "x" });
    page = await tap(token, { action: "delete" });
    expect(text(page.html)).toContain("Question 2 of 5");
    expect(
      (await db.query("select 1 from public.answers where student_id = $1", [ife])).rows,
    ).toHaveLength(1);
  });
});

describe("links", () => {
  it("expire after 24 hours, and forged or altered links don't work", async () => {
    const token = linkFor(tunde, new Date(clock - 24 * 3600_000));
    expect((await open(token)).status).toBe(410);
    const good = linkFor(tunde);
    const altered = `${good.slice(0, 10)}${good[10] === "A" ? "B" : "A"}${good.slice(11)}`;
    expect((await open(altered)).status).toBe(404);
    expect(
      (
        await open(
          signPracticeLink(
            { studentId: tunde, issuedAt: now() },
            "another-secret-another-secret-123",
          ),
        )
      ).status,
    ).toBe(404);
    expect((await open("short")).status).toBe(404);
    const post = await practicePost(altered, new URLSearchParams({ action: "start" }), deps());
    expect(post.status).toBe(404);
  });

  it("are tied to one day: yesterday's link can't start a new set", async () => {
    const yesterday = linkFor(ife, new Date(clock - 20 * 3600_000));
    expect(verifyPracticeLink(yesterday, SECRET, now())).toMatchObject({
      ok: true,
      day: "2026-10-04",
    });
    const page = await open(yesterday);
    expect(page.status).toBe(410);
    expect(text(page.html)).toContain("This link was for another day");
    await practicePost(yesterday, new URLSearchParams({ action: "start" }), deps());
    expect(await sessions(ife)).toHaveLength(1); // only today's
  });

  it("stop working when the student is deleted", async () => {
    const gone = await createStudent(db, parent, { firstName: "Gone" });
    const token = linkFor(gone);
    await db.query("delete from public.students where id = $1", [gone]);
    expect((await open(token)).status).toBe(404);
  });
});

describe("access", () => {
  it("waits for guardian consent", async () => {
    const waiting = await createStudent(db, parent, { firstName: "Bisi", consent: false });
    const page = await open(linkFor(waiting));
    expect(page.status).toBe(403);
    expect(text(page.html)).toContain("a parent or guardian needs to agree first");
  });

  it("an inactive junior gets a note for the parent; an inactive senior a sponsor link", async () => {
    const junior = await createStudent(db, parent, {
      firstName: "Yemi",
      birthYear: JUNIOR_BIRTH_YEAR,
    });
    const senior = await createStudent(db, parent, { firstName: "Segun" });
    const j = await open(linkFor(junior));
    expect(j.status).toBe(402);
    expect(text(j.html)).toContain("Parents: you can restart it");
    expect(j.html).toContain(`${APP}/app`);
    expect(j.html).not.toContain("/sponsor/");
    const s = await open(linkFor(senior));
    expect(s.status).toBe(402);
    expect(s.html).toMatch(new RegExp(`${APP}/sponsor/\\w+`));
  });

  it("says so when there are no questions for the student's subjects", async () => {
    const store = createPgBillingStore(db);
    const physics = await createStudent(db, parent, { firstName: "Tobi" });
    await db.query("update public.students set subjects = '{physics}' where id = $1", [physics]);
    await startFreeTrial(store, physics, now());
    const res = await practicePost(
      linkFor(physics),
      new URLSearchParams({ action: "start" }),
      deps(),
    );
    expect(res.status).toBe(200);
    expect(text(await res.text())).toContain("No questions yet");
  });
});

describe("the page itself", () => {
  it("is small, escapes names and locks down what can run", async () => {
    const odd = await createStudent(db, parent, { firstName: "<b>Jo</b>" });
    await startFreeTrial(createPgBillingStore(db), odd, now());
    const res = await practiceGet(linkFor(odd), new URL(`${APP}/p/x`), deps());
    const html = await res.text();
    expect(html).toContain("&lt;b&gt;Jo&lt;/b&gt;");
    expect(html).not.toContain("<b>Jo</b>");
    expect(Buffer.byteLength(html)).toBeLessThan(15_000);
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  });
});

describe("today's links for every active student (admin, pilot console)", () => {
  it("covers active, consented students; a junior's link goes to the parent", async () => {
    const issuedAt = now();
    const links = await todaysLinks(sql, { appUrl: APP, secret: SECRET, issuedAt });
    const names = links.map((l) => l.firstName);
    expect(names).toEqual(expect.arrayContaining(["Kemi", "Tunde", "Ife"]));
    expect(names).not.toContain("Bisi"); // no consent
    expect(names).not.toContain("Yemi"); // no plan
    const kemiLink = links.find((l) => l.firstName === "Kemi")!;
    expect(kemiLink).toMatchObject({
      junior: true,
      sendTo: { who: "parent", whatsapp: "+447700900123", email: "parent@example.com" },
    });
    expect(kemiLink.message).toContain("hand it to Kemi");
    const token = kemiLink.url.split("/p/")[1]!;
    expect(verifyPracticeLink(token, SECRET, issuedAt)).toMatchObject({
      ok: true,
      studentId: kemi,
    });
    expect(links.find((l) => l.firstName === "Tunde")!.sendTo).toEqual({
      who: "student",
      whatsapp: "+2348020000001",
      email: null,
    });
    // Ife has no WhatsApp number, so her link goes to the parent too.
    expect(links.find((l) => l.firstName === "Ife")!.sendTo.who).toBe("parent");
    for (const l of links.filter((x) => x.junior)) expect(l.sendTo.who).toBe("parent");
  });
});
