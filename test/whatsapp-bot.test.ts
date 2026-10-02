import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { startFreeTrial } from "@/lib/payments/trial";
import { COPY } from "@/lib/whatsapp/bot";
import { enqueueInbound, processJobs } from "@/lib/whatsapp/jobs";
import type { Outbound } from "@/lib/whatsapp/messages";
import { sendMorningNudges } from "@/lib/whatsapp/morning";
import { createOutbox, simulatedTransport } from "@/lib/whatsapp/outbox";
import { conversation, simulateInbound } from "@/lib/whatsapp/simulator";
import { createStudent, createTestDb, createUser, SENIOR_BIRTH_YEAR } from "./db/harness";
import { createPgBillingStore } from "./db/pg-store";
import { pgliteSql } from "./db/sql-pglite";

// The bot's "Done when", through the simulator path (fake Meta webhook -> job table -> bot):
// a full set, two siblings on one number, STOP, and an inactive student's sponsor link.

const APP = "https://kinprep.test";
let db: PGlite;
let sql: ReturnType<typeof pgliteSql>;

const SOLO = "+2348010000001";
const HOUSE = "+2348010000002";
const LAPSED = "+2348010000003";
const NO_CONSENT = "+2348010000004";

let bola: string;
let ada: string;
let chidi: string;
let emeka: string;
let clock = Date.parse("2026-10-05T08:00:00Z"); // a Monday morning in Lagos
const now = () => new Date(clock);

async function addQuestions() {
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
  await db.query("insert into public.settings (key, value) values ('questions_per_day', '3')");
}

beforeAll(async () => {
  db = await createTestDb();
  sql = pgliteSql(db);
  const store = createPgBillingStore(db);
  const parent = await createUser(db);
  await db.query("update public.students set whatsapp_number = null"); // clean slate
  bola = await createStudent(db, parent, { firstName: "Bola", whatsapp: SOLO });
  ada = await createStudent(db, parent, { firstName: "Ada", whatsapp: HOUSE });
  chidi = await createStudent(db, parent, { firstName: "Chidi", whatsapp: HOUSE });
  emeka = await createStudent(db, parent, { firstName: "Emeka", whatsapp: LAPSED });
  await createStudent(db, parent, { firstName: "Funmi", whatsapp: NO_CONSENT, consent: false });
  for (const s of [bola, ada, chidi]) await startFreeTrial(store, s, now());
  await addQuestions();
  void SENIOR_BIRTH_YEAR;
});

let lastSeen = 0;
/** Sends like the simulator page and returns the bot's replies to that message. */
async function say(
  phone: string,
  input: { text?: string; tap?: { id: string; title?: string; kind?: "button" | "list" } },
) {
  clock += 5_000;
  await simulateInbound(
    sql,
    { appUrl: APP },
    {
      phone,
      text: input.text,
      reply: input.tap
        ? { id: input.tap.id, title: input.tap.title ?? "tap", kind: input.tap.kind ?? "button" }
        : undefined,
    },
    now(),
  );
  const rows = await conversation(sql, phone, lastSeen);
  lastSeen = Math.max(lastSeen, ...rows.map((r) => r.id));
  // Blocked attempts are logged too; only what actually went out counts as a reply.
  return rows
    .filter((r) => r.direction === "out" && r.status !== "blocked")
    .map((r) => r.body as Outbound);
}

const bodyText = (m: Outbound) => (m.kind === "template" ? m.name : m.text);
const all = (msgs: Outbound[]) => msgs.map(bodyText).join("\n---\n");
function choices(m: Outbound): { id: string; title: string }[] {
  if (m.kind === "buttons") return m.buttons;
  if (m.kind === "list") return m.rows;
  return [];
}
const find = (msgs: Outbound[], title: RegExp) =>
  msgs.flatMap(choices).find((c) => title.test(c.title)) ??
  expect.fail(`no choice ${title} in:\n${all(msgs)}`);

/** Answers the current question (A is always right in the fixtures) and returns the replies. */
async function answerCurrent(phone: string, msgs: Outbound[], letter: "A" | "B") {
  const question = msgs.find(
    (m) => m.kind === "list" || (m.kind === "buttons" && /Question \d/.test(m.text)),
  )!;
  const option = choices(question).find((c) => c.title.startsWith(`${letter})`))!;
  return say(phone, {
    tap: { id: option.id, title: option.title, kind: question.kind === "list" ? "list" : "button" },
  });
}

describe("a student completes a full set", () => {
  it("START, one question at a time, marking, explanations, summary", async () => {
    let replies = await say(SOLO, { text: "START" });
    expect(all(replies)).toContain("Today's set has 3 questions");
    expect(all(replies)).toMatch(/Question 1 of 3/);
    // Four options don't fit WhatsApp's 3 reply buttons, so they come as a list.
    expect(replies.at(-1)!.kind).toBe("list");

    replies = await answerCurrent(SOLO, replies, "A");
    expect(all(replies)).toContain("✅ Correct!");
    expect(all(replies)).toContain("Because the first option is right");
    const explain = find(replies, /Explain another way/);
    const alt = await say(SOLO, { tap: explain });
    expect(all(alt)).toContain("Here it is in Pidgin");

    replies = await say(SOLO, { tap: find(replies, /Next question/) });
    expect(all(replies)).toMatch(/Question 2 of 3/);
    replies = await answerCurrent(SOLO, replies, "B");
    expect(all(replies)).toContain("❌ Not quite. The answer is A) The correct answer.");

    replies = await say(SOLO, { tap: find(replies, /Next question/) });
    replies = await say(SOLO, { text: "a" }); // typed answers work too
    expect(all(replies)).toContain("✅ Correct!");
    replies = await say(SOLO, { tap: find(replies, /See my score/) });
    const summary = all(replies);
    expect(summary).toContain("You finished today's set");
    expect(summary).toContain("Score: 2/3");
    expect(summary).toContain("Streak: 0 days"); // 3 answers is below the 5 a day needed for a streak day
    expect(summary).toContain("LEAGUE");

    const { rows } = await db.query("select correct from public.answers where student_id = $1", [
      bola,
    ]);
    expect(rows).toHaveLength(3);
    expect(all(await say(SOLO, { text: "START" }))).toContain(
      "You've finished today's set, Bola: 2/3",
    );
  });

  it("ignores an old button instead of answering twice", async () => {
    const { rows } = await db.query<{ n: number }>(
      "select count(*)::int as n from public.answers where student_id = $1",
      [bola],
    );
    const replies = await say(SOLO, { tap: { id: `ans:${randomUUID()}:0:1`, kind: "list" } });
    expect(all(replies)).toContain("finished today's set");
    const after = await db.query<{ n: number }>(
      "select count(*)::int as n from public.answers where student_id = $1",
      [bola],
    );
    expect(after.rows[0]!.n).toBe(rows[0]!.n);
  });

  it("answers SCORE, STREAK, LEAGUE (first name and initial only) and HELP", async () => {
    expect(all(await say(SOLO, { text: "score" }))).toContain("Today: 2/3");
    expect(all(await say(SOLO, { text: "STREAK" }))).toMatch(/Streak: 0 days[\s\S]*This week: M/);
    const leagueText = all(await say(SOLO, { text: "LEAGUE" }));
    expect(leagueText).toContain("1. Bola O. – 2 correct");
    expect(leagueText).not.toMatch(/\+234/);
    expect(all(await say(SOLO, { text: "help" }))).toContain("STOP: stop all messages");
    const menu = await say(SOLO, { text: "what is this" });
    expect(menu[0]!.kind).toBe("buttons");
  });
});

describe("two siblings on one number", () => {
  it("asks who's practising, and each gets their own set", async () => {
    let replies = await say(HOUSE, { text: "START" });
    expect(all(replies)).toBe("Who's practising today?");
    replies = await say(HOUSE, { tap: { ...find(replies, /^Ada/), kind: "list" } });
    expect(all(replies)).toContain("Hi Ada!");
    for (let i = 0; i < 3; i++) {
      replies = await answerCurrent(HOUSE, replies, "A");
      replies = await say(HOUSE, { tap: find(replies, /Next question|See my score/) });
    }
    expect(all(replies)).toContain("Well done, Ada!");

    // Ada is done: the number is free for Chidi.
    replies = await say(HOUSE, { text: "START" });
    expect(all(replies)).toBe("Who's practising today?");
    replies = await say(HOUSE, { tap: { ...find(replies, /^Chidi/), kind: "list" } });
    expect(all(replies)).toContain("Hi Chidi!");
    replies = await answerCurrent(HOUSE, replies, "A");
    expect(all(replies)).toContain("✅ Correct!");

    const sessions = await db.query<{ student_id: string; n: number }>(
      `select s.student_id::text, count(a.id)::int as n from public.practice_sessions s
       left join public.answers a on a.session_id = s.id
       where s.student_id in ($1, $2) group by s.student_id`,
      [ada, chidi],
    );
    expect(new Map(sessions.rows.map((r) => [r.student_id, r.n]))).toEqual(
      new Map([
        [ada, 3],
        [chidi, 1],
      ]),
    );
  });

  it("remembers the choice for the rest of the session", async () => {
    const replies = await say(HOUSE, { text: "SCORE" });
    expect(all(replies)).toContain("Chidi's score");
  });
});

describe("STOP", () => {
  it("opts out of everything business-started, confirms, and START opts back in", async () => {
    expect(all(await say(SOLO, { text: "stop" }))).toBe(COPY.stopped);
    const { rows } = await db.query<{ opted_out_at: Date | null }>(
      "select opted_out_at from public.wa_contacts where phone = $1",
      [SOLO],
    );
    expect(rows[0]!.opted_out_at).not.toBeNull();

    // The morning nudge is business-started: blocked.
    const outbox = createOutbox({ sql, transport: simulatedTransport(), now });
    const template: Outbound = { kind: "template", name: "kinprep_morning", language: "en" };
    expect(await outbox.send(SOLO, template, { businessInitiated: true })).toBe("blocked");

    expect(all(await say(SOLO, { text: "SCORE" }))).toBe(COPY.optedOut);
    expect(all(await say(SOLO, { text: "START" }))).toContain(COPY.welcomeBack);
    expect(await outbox.send(SOLO, template, { businessInitiated: true })).toBe("simulated");
  });
});

describe("students who can't practise", () => {
  it("sends an inactive student their personal Get-sponsored link", async () => {
    const replies = await say(LAPSED, { text: "START" });
    const { rows } = await db.query<{ code: string }>(
      "select code from public.sponsor_links where student_id = $1",
      [emeka],
    );
    expect(rows).toHaveLength(1);
    expect(all(replies)).toContain("Hi Emeka! Your KinPrep practice is paused");
    expect(all(replies)).toContain(`${APP}/sponsor/${rows[0]!.code}`);
    // The same link every time.
    expect(all(await say(LAPSED, { text: "START" }))).toContain(`/sponsor/${rows[0]!.code}`);
  });

  it("tells a student without guardian consent nothing personal", async () => {
    const text = all(await say(NO_CONSENT, { text: "START" }));
    expect(text).toBe(COPY.awaitingConsent);
    expect(text).not.toContain("Funmi");
  });

  it("offers an unknown number the free trial for their parent, and asks for no details", async () => {
    const text = all(await say("+2348019999999", { text: "hi" }));
    expect(text).toContain(`${APP}/?ref=whatsapp`);
    expect(text).toContain("ask your parent or guardian to sign up");
    expect(text).not.toMatch(/name|class|age/i);
  });
});

describe("webhook jobs and the 24-hour window", () => {
  it("processes a message once, however often Meta retries it", async () => {
    const message = {
      id: `wamid.${randomUUID()}`,
      from: "+2348019999998",
      sentAt: now().toISOString(),
      kind: "text" as const,
      text: "hi",
    };
    expect(await enqueueInbound(sql, [message])).toBe(1);
    expect(await enqueueInbound(sql, [message])).toBe(0);
    const deps = () => ({
      outbox: createOutbox({ sql, transport: simulatedTransport(), now }),
      appUrl: APP,
    });
    expect(await processJobs(sql, deps, { now })).toBe(1);
    expect(await processJobs(sql, deps, { now })).toBe(0);
    const { rows } = await db.query("select 1 from public.message_log where wa_message_id = $1", [
      message.id,
    ]);
    expect(rows).toHaveLength(1);
  });

  it("allows only templates more than 24 hours after the contact's last message", async () => {
    const outbox = createOutbox({
      sql,
      transport: simulatedTransport(),
      now: () => new Date(clock + 25 * 3_600_000),
    });
    expect(await outbox.send(LAPSED, { kind: "text", text: "Hello again" })).toBe("blocked");
    expect(
      await outbox.send(LAPSED, { kind: "template", name: "kinprep_morning", language: "en" }),
    ).toBe("simulated");
    const { rows } = await db.query<{ status: string; error: string }>(
      "select status, error from public.message_log where phone = $1 and status = 'blocked'",
      [LAPSED],
    );
    expect(rows[0]!.error).toMatch(/24-hour/);
  });
});

describe("morning nudge", () => {
  it("sends one template per household with an active student, skipping STOP and inactive numbers", async () => {
    await db.query("update public.wa_contacts set opted_out_at = now() where phone = $1", [SOLO]);
    const before = await db.query<{ id: number }>(
      "select coalesce(max(id), 0)::int as id from public.message_log",
    );
    const outbox = createOutbox({ sql, transport: simulatedTransport(), now });
    const result = await sendMorningNudges(
      sql,
      outbox,
      { name: "kinprep_morning", language: "en" },
      now(),
    );
    // HOUSE (Ada and Chidi): one template. SOLO: opted out. LAPSED: inactive. NO_CONSENT: no consent.
    expect(result.sent).toBe(1);
    const { rows } = await db.query<{ phone: string }>(
      "select phone from public.message_log where kind = 'template' and status <> 'blocked' and id > $1",
      [before.rows[0]!.id],
    );
    expect(rows.map((r) => r.phone)).toEqual([HOUSE]);
    await db.query("update public.wa_contacts set opted_out_at = null where phone = $1", [SOLO]);
  });
});

describe("encouragement", () => {
  it("is delivered once, the next time the student starts", async () => {
    await db.query("delete from public.practice_sessions where student_id = $1", [chidi]);
    await db.query(
      "insert into public.encouragements (student_id, message) values ($1, 'Proud of you, Chidi!')",
      [chidi],
    );
    clock += 3_600_000;
    let replies = await say(HOUSE, { text: "START" });
    if (all(replies) === "Who's practising today?")
      replies = await say(HOUSE, { tap: { ...find(replies, /^Chidi/), kind: "list" } });
    expect(all(replies)).toContain("💬 A message from home");
    expect(all(replies)).toContain("Proud of you, Chidi!");
    const { rows } = await db.query(
      "select delivered_at from public.encouragements where student_id = $1",
      [chidi],
    );
    expect(rows[0]).toMatchObject({ delivered_at: expect.any(Date) });
  });
});
