import { readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { cronSchedule } from "@/config/messaging";
import { simulatedEmailTransport, type EmailTransport } from "@/lib/jobs/email";
import { enqueue, runQueue, type QueueItem } from "@/lib/jobs/queue";
import type { Transport } from "@/lib/whatsapp/outbox";
import { createTestDb } from "./db/harness";
import { pgliteSql } from "./db/sql-pglite";

// The outbound queue's worker: sending limits, retries with backoff, STOP, expiry, and channels
// that aren't set up yet.

let db: PGlite;
let sql: ReturnType<typeof pgliteSql>;
let clock: number;
const now = () => new Date(clock);

beforeEach(async () => {
  db = await createTestDb();
  sql = pgliteSql(db);
  clock = Date.parse("2026-10-05T06:00:00Z");
});

const item = (n: number, overrides: Partial<QueueItem> = {}): QueueItem => ({
  job: "morning",
  dedupeKey: `test:${n}`,
  channel: "whatsapp",
  recipient: `+23480100000${String(n).padStart(2, "0")}`,
  category: "utility",
  template: "kinprep_morning_practice",
  payload: { kind: "template", name: "kinprep_morning_practice", language: "en", body: ["Ada"] },
  preview: "Good morning Ada!",
  lagosDay: "2026-10-05",
  expiresAt: new Date(clock + 12 * 3600_000),
  ...overrides,
});

const statuses = async () =>
  (
    await db.query<{ status: string; attempts: number }>(
      "select status, attempts from public.outbound_queue order by id",
    )
  ).rows;

function countingTransport(fail = false): Transport & { sent: string[] } {
  const sent: string[] = [];
  return {
    simulated: true,
    sent,
    async send(to) {
      if (fail) throw new Error("Meta said no");
      sent.push(to);
      return `wamid.${sent.length}`;
    },
  };
}

describe("sending limits", () => {
  it("paces sends to the per-second setting", async () => {
    await db.query(
      "insert into public.settings (key, value) values ('wa_messages_per_second', '4')",
    );
    for (let n = 1; n <= 3; n++) await enqueue(sql, item(n), { dryRun: false, now: now() });
    const waits: number[] = [];
    const transport = countingTransport();
    await runQueue({
      sql,
      whatsapp: transport,
      email: null,
      now,
      sleep: async (ms) => void waits.push(ms),
    });
    expect(transport.sent).toHaveLength(3);
    // 4 a second = 250 ms apart (the first send waits for nothing before it).
    expect(waits.length).toBeGreaterThanOrEqual(2);
    for (const w of waits) expect(w).toBeLessThanOrEqual(250);
    expect(Math.max(...waits)).toBeGreaterThan(200);
  });

  it("stops at the daily limit and leaves the rest waiting", async () => {
    await db.query("insert into public.settings (key, value) values ('wa_messages_per_day', '2')");
    for (let n = 1; n <= 3; n++) await enqueue(sql, item(n), { dryRun: false, now: now() });
    const transport = countingTransport();
    const result = await runQueue({
      sql,
      whatsapp: transport,
      email: null,
      now,
      sleep: async () => {},
    });
    expect(result).toMatchObject({ sent: 2, waiting: 1 });
    // 24 hours later there's room again.
    clock += 24 * 3600_000 + 1000;
    await db.query("update public.outbound_queue set expires_at = $1", [
      new Date(clock + 3600_000),
    ]);
    const later = await runQueue({
      sql,
      whatsapp: transport,
      email: null,
      now,
      sleep: async () => {},
    });
    expect(later).toMatchObject({ sent: 1, waiting: 0 });
  });
});

describe("retries", () => {
  it("backs off after each failure (30 s, 2 min, 10 min, 1 h, 6 h), then gives up", async () => {
    await enqueue(sql, item(1, { expiresAt: new Date(clock + 48 * 3600_000) }), {
      dryRun: false,
      now: now(),
    });
    const failing = countingTransport(true);
    const waits = [30, 120, 600, 3_600, 21_600];
    for (const [i, wait] of waits.entries()) {
      const r = await runQueue({ sql, whatsapp: failing, email: null, now, sleep: async () => {} });
      expect(r.retrying).toBe(1);
      const [row] = (
        await db.query<{ next: Date; attempts: number; last_error: string }>(
          "select next_attempt_at as next, attempts, last_error from public.outbound_queue",
        )
      ).rows;
      expect(row!.attempts).toBe(i + 1);
      expect(new Date(row!.next).getTime() - clock).toBe(wait * 1000);
      expect(row!.last_error).toContain("Meta said no");
      // Not before the backoff is over.
      expect(
        (await runQueue({ sql, whatsapp: failing, email: null, now, sleep: async () => {} }))
          .retrying,
      ).toBe(0);
      clock += wait * 1000;
    }
    const last = await runQueue({
      sql,
      whatsapp: failing,
      email: null,
      now,
      sleep: async () => {},
    });
    expect(last.failed).toBe(1);
    expect(await statuses()).toEqual([{ status: "failed", attempts: 6 }]);
    // Every attempt is in the message log.
    const { rows } = await db.query<{ n: number }>(
      "select count(*)::int as n from public.message_log where status = 'failed'",
    );
    expect(rows[0]!.n).toBe(6);
  });

  it("succeeds on a retry and records the send once", async () => {
    await enqueue(sql, item(1), { dryRun: false, now: now() });
    await runQueue({
      sql,
      whatsapp: countingTransport(true),
      email: null,
      now,
      sleep: async () => {},
    });
    clock += 30_000;
    const ok = countingTransport();
    expect(
      (await runQueue({ sql, whatsapp: ok, email: null, now, sleep: async () => {} })).sent,
    ).toBe(1);
    expect(await statuses()).toEqual([{ status: "sent", attempts: 2 }]);
    const { rows } = await db.query<{ provider_message_id: string; estimated_cost_usd: string }>(
      "select provider_message_id, estimated_cost_usd::text from public.outbound_queue",
    );
    expect(rows[0]).toEqual({ provider_message_id: "wamid.1", estimated_cost_usd: "0.0067" });
  });
});

describe("rules the queue keeps", () => {
  it("never sends to a number that sent STOP", async () => {
    await db.query(
      "insert into public.wa_contacts (phone, opted_out_at) values ('+2348010000001', now())",
    );
    await enqueue(sql, item(1), { dryRun: false, now: now() });
    const transport = countingTransport();
    const r = await runQueue({ sql, whatsapp: transport, email: null, now, sleep: async () => {} });
    expect(r.blocked).toBe(1);
    expect(transport.sent).toEqual([]);
  });

  it("charges nothing for a utility template inside the 24-hour window", async () => {
    await db.query(
      "insert into public.wa_contacts (phone, last_inbound_at) values ('+2348010000001', $1)",
      [new Date(clock - 3600_000)],
    );
    await enqueue(sql, item(1), { dryRun: false, now: now() });
    await runQueue({ sql, whatsapp: countingTransport(), email: null, now, sleep: async () => {} });
    const { rows } = await db.query<{ cost: string }>(
      "select estimated_cost_usd::text as cost from public.message_log",
    );
    expect(rows).toEqual([{ cost: "0.0000" }]);
  });

  it("drops messages that expired before they could be sent (no morning message at night)", async () => {
    await enqueue(sql, item(1), { dryRun: false, now: now() });
    clock += 13 * 3600_000;
    const r = await runQueue({
      sql,
      whatsapp: countingTransport(),
      email: null,
      now,
      sleep: async () => {},
    });
    expect(r).toMatchObject({ sent: 0, expired: 1 });
    expect(await statuses()).toEqual([{ status: "failed", attempts: 0 }]);
  });

  it("keeps messages waiting while their channel isn't set up, and never sends dry runs", async () => {
    await enqueue(sql, item(1), { dryRun: false, now: now() });
    await enqueue(
      sql,
      item(2, {
        channel: "email",
        recipient: "parent@example.com",
        template: null,
        category: "email",
        payload: { to: "parent@example.com", subject: "Hi", text: "Hello" },
      }),
      { dryRun: false, now: now() },
    );
    await enqueue(sql, item(3), { dryRun: true, now: now() });
    const none = await runQueue({ sql, whatsapp: null, email: null, now, sleep: async () => {} });
    expect(none).toMatchObject({ sent: 0, waiting: 2 });
    const emails: string[] = [];
    const email: EmailTransport = {
      simulated: true,
      send: async (m) => {
        emails.push(m.to);
        return "email.1";
      },
    };
    const r = await runQueue({ sql, whatsapp: null, email, now, sleep: async () => {} });
    expect(r).toMatchObject({ sent: 1, waiting: 1 });
    expect(emails).toEqual(["parent@example.com"]);
    const all = await runQueue({
      sql,
      whatsapp: countingTransport(),
      email: simulatedEmailTransport(),
      now,
      sleep: async () => {},
    });
    expect(all).toMatchObject({ sent: 1, waiting: 0 });
    expect((await statuses()).map((s) => s.status)).toEqual(["sent", "sent", "dry_run"]);
  });
});

describe("the cron schedule", () => {
  it("matches vercel.json, and every entry runs at most once a day (Vercel Hobby)", () => {
    const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as {
      crons: { path: string; schedule: string }[];
    };
    expect(vercel.crons).toEqual(cronSchedule());
    expect(vercel.crons.length).toBeLessThanOrEqual(100);
    for (const c of vercel.crons) expect(c.schedule).toMatch(/^\d{1,2} \d{1,2} \* \* [\d*]$/);
  });

  it("covers every hour from Saturday 18:00 in Lagos to Sunday 21:00 on the US west coast", () => {
    const weekly = cronSchedule().filter((c) => c.path === "/api/jobs/weekly-reports");
    const hours = new Set(
      weekly.map((c) => {
        const [, hour, , , day] = c.schedule.split(" ");
        return `${day}:${hour}`;
      }),
    );
    // Saturday 17:00 UTC (18:00 Lagos) ... Monday 05:00 UTC (Sunday 21:00 PST).
    for (let h = 17; h <= 23; h++) expect(hours).toContain(`6:${h}`);
    for (let h = 0; h <= 23; h++) expect(hours).toContain(`0:${h}`);
    for (let h = 0; h <= 5; h++) expect(hours).toContain(`1:${h}`);
  });
});
