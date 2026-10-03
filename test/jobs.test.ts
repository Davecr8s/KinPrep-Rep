import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { simulatedEmailTransport } from "@/lib/jobs/email";
import { formatReport, runJob, type JobName, type JobReport } from "@/lib/jobs/jobs";
import { runQueue, type WorkerResult } from "@/lib/jobs/queue";
import { verifyPracticeLink } from "@/lib/practice/links";
import { simulatedTransport } from "@/lib/whatsapp/outbox";
import { createTestDb } from "./db/harness";
import { seedDemoPeople, type DemoIds } from "./db/demo-seed";
import { pgliteSql } from "./db/sql-pglite";

// The scheduled jobs' "Done when", against the dev seed's people (scripts/lib/demo-people.ts):
// each job's dry run shows exactly who would get what, a second run sends nothing extra, and the
// reminder respects settings.reminder_enabled. `npm run jobs:demo` prints every run.

const APP = "https://kinprep.test";
const SECRET = "jobs-test-practice-link-secret-0123456789";
const PARENT = "+2348000000009";
const HOUSE = "+2348000000001";
const SPONSOR_EMAIL = "demo-sponsor@kinprep.test";
// Sunday 11 October 2026, in Lagos (UTC+1).
const at = (lagosTime: string) => new Date(`2026-10-11T${lagosTime}:00+01:00`);

let db: PGlite;
let sql: ReturnType<typeof pgliteSql>;
let ids: DemoIds;
const print = process.env.npm_lifecycle_event === "jobs:demo";

beforeAll(async () => {
  db = await createTestDb();
  sql = pgliteSql(db);
  ids = await seedDemoPeople(db, at("06:00"));
}, 60_000);

async function run(
  job: JobName,
  when: Date,
  dryRun: boolean,
): Promise<{ report: JobReport; worker: WorkerResult | null }> {
  const report = await runJob(job, { sql, now: when, dryRun, appUrl: APP, practiceSecret: SECRET });
  const worker = dryRun
    ? null
    : await runQueue({
        sql,
        whatsapp: simulatedTransport(),
        email: simulatedEmailTransport(),
        now: () => when,
        sleep: async () => {},
      });
  if (print) {
    console.log(
      `${formatReport(report)}${worker ? `\n  worker: sent ${worker.sent}, blocked ${worker.blocked}, retrying ${worker.retrying}, failed ${worker.failed}, waiting ${worker.waiting}` : ""}\n`,
    );
  }
  return { report, worker };
}

const fresh = (r: JobReport) =>
  r.planned.filter((p) => p.queued).map((p) => [p.channel, p.to, p.about, p.message]);

/** Dry run twice, then for real twice: the dry run is exact, and nothing is ever sent twice. */
async function checkIdempotent(job: JobName, when: Date) {
  const dry = await run(job, when, true);
  expect(fresh((await run(job, when, true)).report), "second dry run").toEqual([]);
  const live = await run(job, when, false);
  expect(fresh(live.report), "real run sends what the dry run showed").toEqual(fresh(dry.report));
  expect(live.worker!.sent).toBe(fresh(dry.report).length);
  const again = await run(job, when, false);
  expect(fresh(again.report), "second real run").toEqual([]);
  expect(again.worker!.sent).toBe(0);
  return dry.report;
}

describe("07:00 morning message", () => {
  it("goes once to each household number with an opted-in active senior", async () => {
    const report = await checkIdempotent("morning", at("07:00"));
    expect(fresh(report)).toEqual([
      ["whatsapp", HOUSE, "Ada and Chidi", "kinprep_morning_practice"],
    ]);
    expect(report.planned[0]!.preview).toBe(
      "Good morning Ada and Chidi! Your KinPrep practice for today is ready. Tap Start when you are ready to begin. [Start]",
    );
    expect(report.skipped).toEqual([
      { who: "Emeka", reason: "plan not active" },
      { who: "Tunde", reason: "hasn't opted in to WhatsApp messages" },
    ]);
  });
});

describe("07:00 junior practice links", () => {
  it("send each active junior's link to the parent's WhatsApp, never to the child", async () => {
    const report = await checkIdempotent("junior-links", at("07:00"));
    expect(fresh(report)).toEqual([["whatsapp", PARENT, "Kemi", "kinprep_junior_practice_link"]]);
    const token = report.planned[0]!.preview.match(/\/p\/([\w-]+)\]$/)![1]!;
    expect(verifyPracticeLink(token, SECRET, at("07:00"))).toMatchObject({
      ok: true,
      studentId: ids.students.Kemi,
    });
  });
});

describe("18:00 reminder", () => {
  it("sends nothing while settings.reminder_enabled is off", async () => {
    const off = await run("reminder", at("18:00"), true);
    expect(off.report.note).toMatch(/Reminders are off/);
    expect(off.report.planned).toEqual([]);
    await db.query("insert into public.settings (key, value) values ('reminder_enabled', 'false')");
    expect((await run("reminder", at("18:00"), false)).report.planned).toEqual([]);
  });

  it("when on, reminds only opted-in seniors who haven't started today", async () => {
    await db.query("update public.settings set value = 'true' where key = 'reminder_enabled'");
    const report = await checkIdempotent("reminder", at("18:00"));
    expect(fresh(report)).toEqual([["whatsapp", HOUSE, "Chidi", "kinprep_practice_reminder"]]);
    expect(report.skipped).toEqual(
      expect.arrayContaining([
        { who: "Ada", reason: "already started today" },
        { who: "Tunde", reason: "hasn't opted in to WhatsApp messages" },
      ]),
    );
  });
});

describe("21:00 missed days", () => {
  it("tells each payer once when a student has missed 2 days in a row, and flags the dashboard", async () => {
    const report = await checkIdempotent("missed-days", at("21:00"));
    expect(fresh(report)).toEqual([["whatsapp", PARENT, "Chidi", "kinprep_missed_days"]]);
    expect(report.planned[0]!.preview).toContain(
      "KinPrep update: Chidi has not practised for 2 days in a row.",
    );
    const { rows } = await db.query<{ first_name: string; since_day: string; days: number }>(
      `select s.first_name, a.since_day::text, a.days from public.student_alerts a
       join public.students s on s.id = a.student_id`,
    );
    expect(rows).toEqual([{ first_name: "Chidi", since_day: "2026-10-10", days: 2 }]);
    // Next evening it's 3 days: same lapse, so no second message.
    const nextDay = await run("missed-days", new Date(at("21:00").getTime() + 86_400_000), true);
    expect(fresh(nextDay.report).filter((p) => p[2] === "Chidi")).toEqual([]);
  });
});

describe("weekly reports", () => {
  it("go at each payer's chosen time in their own timezone", async () => {
    // Sunday 10:00 in Lagos (09:00 in London): the sponsor chose Saturday 19:00, so theirs is
    // due (a run that catches up after a missed one); the parent chose Sunday 18:00, not yet.
    const morning = await run("weekly-reports", at("10:00"), false);
    expect(fresh(morning.report)).toEqual([
      ["email", SPONSOR_EMAIL, "Tunde", "Tunde's KinPrep week: 3 of 7 days"],
    ]);
    expect(morning.worker!.sent).toBe(1);
    expect(morning.report.skipped).toContainEqual({
      who: "Ada, Chidi, Emeka and Kemi (payer)",
      reason: "report time is Sunday 18:00 Africa/Lagos",
    });
  });

  it("by WhatsApp to opted-in payers, by email to the others, once a week", async () => {
    const report = await checkIdempotent("weekly-reports", at("18:00"));
    expect(fresh(report)).toEqual([
      ["whatsapp", PARENT, "Ada", "kinprep_weekly_report"],
      ["whatsapp", PARENT, "Chidi", "kinprep_weekly_report"],
      ["whatsapp", PARENT, "Kemi", "kinprep_weekly_report"],
    ]);
    // Tunde's went this morning: listed, but not sent again.
    expect(report.planned.find((p) => p.about === "Tunde")).toMatchObject({ queued: false });
    const ada = report.planned.find((p) => p.about === "Ada")!.preview;
    expect(ada).toContain("Weekly KinPrep report for Ada: practised on 4 of 7 days.");
    expect(ada).toContain("Average score: 80% (no score last week to compare)");
    expect(ada).toContain("Topic to work on:");
    expect(report.skipped).toContainEqual({ who: "Emeka", reason: "plan not active" });
  });
});

describe("the send log", () => {
  it("records every send with its template, category and estimated cost", async () => {
    const { rows } = await db.query<{
      template: string | null;
      category: string;
      cost: string;
      recipient: string;
    }>(
      `select template, category, estimated_cost_usd::text as cost, coalesce(phone, email) as recipient
       from public.message_log where direction = 'out' order by id`,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      if (r.category === "email") expect(Number(r.cost)).toBe(0);
      else {
        expect(r.template).toMatch(/^kinprep_/);
        expect(r.category).toBe("utility");
        expect(Number(r.cost)).toBe(0.0067); // Nigeria, utility, outside the 24-hour window
      }
    }
    const { rows: dry } = await db.query<{ n: number }>(
      "select count(*)::int as n from public.message_log where queue_id in (select id from public.outbound_queue where dry_run)",
    );
    expect(dry[0]!.n).toBe(0); // dry runs never send
  });
});
