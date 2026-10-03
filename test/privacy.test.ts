import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { leagueFor } from "@/lib/engine/session";
import { runJob } from "@/lib/jobs/jobs";
import { startFreeTrial } from "@/lib/payments/trial";
import { COVERED_TABLES, deleteStudent, exportStudent } from "@/lib/privacy/data-rights";
import { purgeExpired } from "@/lib/privacy/retention";
import { league, type PracticeStudent } from "@/lib/practice/repo";
import { isSeniorBirthYear } from "@/lib/rules/students";
import { COPY } from "@/lib/whatsapp/bot";
import type { Outbound } from "@/lib/whatsapp/messages";
import { createOutbox, simulatedTransport } from "@/lib/whatsapp/outbox";
import { conversation, simulateInbound } from "@/lib/whatsapp/simulator";
import { createStudent, createTestDb, createUser, JUNIOR_BIRTH_YEAR } from "./db/harness";
import { createPgBillingStore } from "./db/pg-store";
import { pgliteSql } from "./db/sql-pglite";

// The privacy rules in CLAUDE.md, against the real schema: consent before any message, nothing
// on WhatsApp for under-13s, first name and initial on leaderboards, export and deletion of
// everything, and retention. Each rule is checked where it is enforced (database, jobs, bot and
// the outbox's last check before sending).

const APP = "https://kinprep.test";
const SECRET = "privacy-test-practice-secret-0123456789";
const NOW = new Date("2026-10-05T08:00:00Z"); // a Monday morning in Lagos
const PARENT = "+2348020000001";
const ADA = "+2348020000002";
const FUNMI = "+2348020000003";
const HOUSE = "+2348020000004";
const STRANGER = "+2348020000099";

let db: PGlite;
let sql: ReturnType<typeof pgliteSql>;
let parent: string;
let ada: string;
let funmi: string;
let kemi: string;
let tola: string;
let tunde: string;

const text = (t: string): Outbound => ({ kind: "text", text: t });
const outbox = () => createOutbox({ sql, transport: simulatedTransport(), now: () => NOW });
const openWindow = (phone: string) =>
  db.query(
    `insert into public.wa_contacts (phone, last_inbound_at) values ($1, $2)
     on conflict (phone) do update set last_inbound_at = $2`,
    [phone, NOW],
  );
const count = async (query: string, params: unknown[]) =>
  (await db.query<{ n: number }>(`select count(*)::int as n from ${query}`, params)).rows[0]!.n;

beforeAll(async () => {
  db = await createTestDb();
  sql = pgliteSql(db);
  const store = createPgBillingStore(db);
  parent = await createUser(db);
  await db.query(
    "update public.payers set whatsapp_number = $2, whatsapp_reports_opt_in_at = $3 where id = $1",
    [parent, PARENT, NOW],
  );
  ada = await createStudent(db, parent, { firstName: "Ada", whatsapp: ADA });
  funmi = await createStudent(db, parent, { firstName: "Funmi", whatsapp: FUNMI, consent: false });
  kemi = await createStudent(db, parent, { firstName: "Kemi", birthYear: JUNIOR_BIRTH_YEAR });
  tola = await createStudent(db, parent, { firstName: "Tola", whatsapp: HOUSE });
  tunde = await createStudent(db, parent, { firstName: "Tunde", whatsapp: HOUSE });
  await db.query("update public.students set whatsapp_opt_in_at = $1", [NOW]);
  for (const s of [ada, funmi, kemi, tola, tunde]) await startFreeTrial(store, s, NOW);
  for (const phone of [PARENT, ADA, FUNMI, HOUSE, STRANGER]) await openWindow(phone);

  const reviewer = await createUser(db, "reviewer");
  const { rows } = await db.query<{ id: string }>(
    "insert into public.topics (subject, name) values ('english', 'Concord') returning id",
  );
  for (let i = 0; i < 2; i++) {
    await db.query(
      `insert into public.questions (subject, topic_id, stem, options, answer_index, explanation_en, status, approved_by, approved_at, original_confirmed)
       values ('english', $1, $2, $3::jsonb, 0, 'Because.', 'approved', $4, now(), true)`,
      [rows[0]!.id, `Concord question ${i + 1}?`, JSON.stringify(["Right", "Wrong"]), reviewer],
    );
  }
  await db.query("insert into public.settings (key, value) values ('questions_per_day', '2')");
});

describe("the under-13 rule", () => {
  it("is judged from birth year only: 13 or over only if 13 even with the latest birthday", async () => {
    for (const at of [NOW, new Date("2026-12-31T23:30:00Z")]) {
      for (const year of [2011, 2012, 2013, 2014]) {
        const { rows } = await db.query<{ senior: boolean }>(
          "select public.is_senior_birth_year($1, $2) as senior",
          [year, at],
        );
        // The database and the app agree, including on Lagos new year (23:30 UTC = 00:30 WAT).
        expect(rows[0]!.senior).toBe(isSeniorBirthYear(year, at));
      }
    }
    expect(isSeniorBirthYear(2012, NOW)).toBe(true); // 14 in 2026: 13 or 14
    expect(isSeniorBirthYear(2013, NOW)).toBe(false); // 12 or 13: treated as under 13
  });

  it("the database refuses a WhatsApp number for a junior, on insert and on update", async () => {
    await expect(
      createStudent(db, parent, { birthYear: JUNIOR_BIRTH_YEAR, whatsapp: "+2348020000050" }),
    ).rejects.toThrow(/under 13/);
    await expect(
      db.query("update public.students set whatsapp_number = $2 where id = $1", [kemi, STRANGER]),
    ).rejects.toThrow(/under 13/);
    // Nor can a senior's birth year be changed to a junior's while they have a number.
    await expect(
      db.query("update public.students set birth_year = $2 where id = $1", [
        ada,
        JUNIOR_BIRTH_YEAR,
      ]),
    ).rejects.toThrow(/under 13/);
  });

  it("the morning job never messages a junior; their link goes to the parent", async () => {
    const ctx = { sql, now: NOW, dryRun: true, appUrl: APP, practiceSecret: SECRET };
    const morning = await runJob("morning", ctx);
    expect(morning.planned.map((p) => p.about).join(" ")).not.toContain("Kemi");
    const links = await runJob("junior-links", ctx);
    expect(links.planned).toEqual([
      expect.objectContaining({ about: "Kemi", channel: "whatsapp", to: PARENT }),
    ]);
  });

  it("the outbox sends a junior's message only to their parent, whatever the caller asks", async () => {
    const send = (to: string) =>
      outbox().deliver(to, text("Kemi's practice"), { studentId: kemi, businessInitiated: true });
    expect(await send(STRANGER)).toEqual({
      status: "blocked",
      error: "not the student's or payer's number",
    });
    expect((await send(PARENT)).status).toBe("simulated");
  });

  it("juniors never see a league with strangers", async () => {
    const junior: PracticeStudent = {
      id: kemi,
      first_name: "Kemi",
      last_initial: "O",
      class: "JSS1",
      subjects: ["english"],
      language: "en",
      group_account_id: null,
      junior: true,
    };
    expect(await leagueFor(sql, junior, "2026-10-05")).toBeNull();
  });
});

describe("guardian consent before any message", () => {
  it("the bot practises nothing with a student until a guardian has agreed", async () => {
    await simulateInbound(sql, { appUrl: APP }, { phone: FUNMI, text: "START" }, NOW);
    const replies = (await conversation(sql, FUNMI)).filter((m) => m.direction === "out");
    expect(replies.map((m) => (m.body as { text?: string }).text)).toEqual([COPY.awaitingConsent]);
    expect(await count("public.practice_sessions where student_id = $1", [funmi])).toBe(0);
  });

  it("the jobs skip a student without consent", async () => {
    const morning = await runJob("morning", {
      sql,
      now: NOW,
      dryRun: true,
      appUrl: APP,
      practiceSecret: SECRET,
    });
    expect(morning.planned.map((p) => p.about).join(" ")).not.toContain("Funmi");
  });

  it("the outbox refuses any message about an unconsented student, or to their number", async () => {
    expect(
      await outbox().deliver(FUNMI, text("Question 1"), {
        studentId: funmi,
        businessInitiated: false,
      }),
    ).toEqual({ status: "blocked", error: "no guardian consent" });
    expect(
      await outbox().deliver(FUNMI, text("Good morning!"), { businessInitiated: true }),
    ).toEqual({ status: "blocked", error: "no guardian consent" });
    // A report to the parent about her is refused too.
    expect(
      (
        await outbox().deliver(PARENT, text("Funmi's week"), {
          studentId: funmi,
          businessInitiated: true,
        })
      ).status,
    ).toBe("blocked");
  });

  it("withdrawing consent stops messages at once; granting it again restarts them", async () => {
    const send = () =>
      outbox().deliver(ADA, text("Good morning, Ada"), { studentId: ada, businessInitiated: true });
    expect((await send()).status).toBe("simulated");
    const record = (event: "withdrawn" | "granted", minutes: number) =>
      db.query(
        `insert into public.guardian_consents (student_id, event, method, consent_text_version, given_by, created_at)
         values ($1, $2, 'web_checkbox', 'test', $3, $4)`,
        [ada, event, parent, new Date(NOW.getTime() + minutes * 60_000)],
      );
    await record("withdrawn", 1);
    expect(await send()).toEqual({ status: "blocked", error: "no guardian consent" });
    await record("granted", 2);
    expect((await send()).status).toBe("simulated");
  });

  it("every blocked attempt is logged, with the reason", async () => {
    const { rows } = await db.query<{ error: string }>(
      "select distinct error from public.message_log where status = 'blocked' order by 1",
    );
    expect(rows.map((r) => r.error)).toEqual(
      expect.arrayContaining(["no guardian consent", "not the student's or payer's number"]),
    );
  });
});

describe("leaderboards", () => {
  it("hold first name and surname initial only", async () => {
    const rows = await league(sql, ada, new Date("2026-10-05T00:00:00+01:00"));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(
        ["answered", "correct", "first_name", "last_initial", "student_id"].sort(),
      );
      expect(row.last_initial).toMatch(/^[A-Z]$/);
    }
  });

  it("show 'Ada O.' on WhatsApp, and nothing else about anyone", async () => {
    await simulateInbound(sql, { appUrl: APP }, { phone: ADA, text: "LEAGUE" }, NOW);
    const [last] = (await conversation(sql, ADA)).filter((m) => m.direction === "out").slice(-1);
    const body = (last!.body as { text: string }).text;
    expect(body).toContain("Ada O.");
    expect(body).not.toContain("+234");
    // Each ranked line: position, first name and initial, score. Nothing else about anyone.
    const ranked = body.split("\n").filter((l) => /^\d+\./.test(l));
    expect(ranked.length).toBeGreaterThan(0);
    for (const line of ranked) expect(line).toMatch(/^\d+\. [A-Z][a-z]+ [A-Z]\. – \d+ correct$/);
  });

  it("the database only accepts a single capital letter as the surname initial", async () => {
    await expect(
      db.query("update public.students set last_initial = 'Okafor' where id = $1", [ada]),
    ).rejects.toThrow(/last_initial/);
  });
});

describe("data export and deletion", () => {
  it("cover every table that holds a student's data", async () => {
    const { rows } = await db.query<{ table_name: string }>(
      `select distinct table_name from information_schema.columns
       where table_schema = 'public'
         and column_name in ('student_id', 'active_student_id', 'phone', 'recipient')`,
    );
    // data_requests is the record that a request was handled: kept on purpose (ids and dates only).
    const missing = rows
      .map((r) => r.table_name)
      .filter((t) => !(t in COVERED_TABLES) && t !== "data_requests");
    expect(missing, "add new tables to src/lib/privacy/data-rights.ts").toEqual([]);
  });

  it("the export holds everything about the student, and no tokens", async () => {
    // A day of practice on WhatsApp, plus the other things a student collects.
    await simulateInbound(sql, { appUrl: APP }, { phone: ADA, text: "START" }, NOW);
    await db.query("insert into public.sponsor_links (code, student_id) values ($1, $2)", [
      "SECRETCODE-should-not-export-1",
      ada,
    ]);
    await db.query(
      "insert into public.encouragements (student_id, sender_id, message) values ($1, $2, 'Well done!')",
      [ada, parent],
    );
    const data = await exportStudent(sql, ada, parent, NOW);
    expect(data!.student).toMatchObject({
      first_name: "Ada",
      last_initial: "O",
      whatsapp_number: ADA,
    });
    for (const section of [
      "guardian_consents",
      "subscriptions",
      "practice_sessions",
      "encouragements",
      "sponsor_links",
      "messages",
      "whatsapp_contact",
    ]) {
      expect(data![section], section).not.toEqual([]);
    }
    const json = JSON.stringify(data);
    expect(json).not.toContain("SECRETCODE");
    expect(json).not.toContain("token_hash");
    expect(
      await count("public.data_requests where student_id = $1 and kind = 'export'", [ada]),
    ).toBe(1);
    expect(await exportStudent(sql, "00000000-0000-4000-8000-000000000000", null, NOW)).toBeNull();
  });

  it("deletion leaves nothing that links to the student or their WhatsApp number", async () => {
    expect(await count("public.message_log where phone = $1", [ADA])).toBeGreaterThan(0);
    expect(await deleteStudent(sql, ada, parent, NOW)).toBe(true);
    for (const table of Object.keys(COVERED_TABLES)) {
      const columns = (
        await db.query<{ column_name: string }>(
          `select column_name from information_schema.columns
           where table_schema = 'public' and table_name = $1
             and column_name in ('id', 'student_id', 'active_student_id', 'phone', 'recipient', 'whatsapp_number')`,
          [table],
        )
      ).rows.map((r) => r.column_name);
      for (const column of columns) {
        const value = ["phone", "recipient", "whatsapp_number"].includes(column) ? ADA : ada;
        expect(
          await count(`public.${table} where ${column}::text = $1`, [value]),
          `${table}.${column}`,
        ).toBe(0);
      }
    }
    expect(await count("public.data_requests where student_id = $1", [ada])).toBe(2); // export, delete
    expect(await deleteStudent(sql, ada, parent, NOW)).toBe(false);
  });

  it("keeps a household number's messages while a sibling still uses it", async () => {
    await simulateInbound(sql, { appUrl: APP }, { phone: HOUSE, text: "HELP" }, NOW);
    const before = await count("public.message_log where phone = $1", [HOUSE]);
    await deleteStudent(sql, tola, parent, NOW);
    expect(await count("public.message_log where phone = $1", [HOUSE])).toBe(before);
    expect(await count("public.wa_contacts where phone = $1", [HOUSE])).toBe(1);
    await deleteStudent(sql, tunde, parent, NOW);
    expect(await count("public.message_log where phone = $1", [HOUSE])).toBe(0);
    expect(await count("public.wa_contacts where phone = $1", [HOUSE])).toBe(0);
  });
});

describe("retention", () => {
  it("deletes old logs and spent rate-limit counters, and nothing recent", async () => {
    const old = new Date("2026-01-01T00:00:00Z");
    await db.query(
      "insert into public.message_log (direction, phone, kind, body, status, created_at) values ('out', $1, 'text', '{}', 'sent', $2), ('out', $1, 'text', '{}', 'sent', $3)",
      [PARENT, old, NOW],
    );
    await db.query(
      "insert into public.rate_limits (bucket, key, window_start) values ('signInIp', 'k', $1), ('signInIp', 'k', $2)",
      [old, NOW],
    );
    await db.query(
      `insert into public.billing_events (provider, event_id, event_type, occurred_at, received_at, processed_at, payload)
       values ('stripe', 'evt_old', 'invoice.paid', $1, $1, $1, '{"customer_email": "a@b.c"}')`,
      [new Date("2025-01-01T00:00:00Z")],
    );
    const purged = await purgeExpired(sql, NOW);
    expect(purged).toMatchObject({ messageLog: 1, rateLimits: 1, billingPayloads: 1 });
    expect(await count("public.message_log where created_at = $1", [NOW])).toBeGreaterThan(0);
    // The event id stays (webhooks stay idempotent); the payload with the email goes.
    const { rows } = await db.query<{ payload: unknown }>(
      "select payload from public.billing_events where event_id = 'evt_old'",
    );
    expect(rows[0]!.payload).toEqual({});
    expect(await purgeExpired(sql, NOW)).toMatchObject({
      messageLog: 0,
      rateLimits: 0,
      billingPayloads: 0,
    });
  });
});
