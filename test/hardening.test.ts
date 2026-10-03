import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { RATE_LIMITS } from "@/config/security";
import { checkHealth } from "@/lib/monitoring/health";
import { createRateLimiter, tooManyRequests } from "@/lib/security/rate-limit";
import { createTestDb } from "./db/harness";
import { pgliteSql } from "./db/sql-pglite";

// Rate limits on public routes and the health check, against the real schema.

const NOW = new Date("2026-10-05T10:03:00Z");
let db: PGlite;
let sql: ReturnType<typeof pgliteSql>;

beforeAll(async () => {
  db = await createTestDb();
  sql = pgliteSql(db);
});

describe("rate limits", () => {
  it("allow sign-in emails up to the limit per inbox, then refuse until the window passes", async () => {
    const limit = createRateLimiter({ sql: () => sql, secret: "test-secret" });
    const { limit: max } = RATE_LIMITS.signInEmail;
    for (let i = 0; i < max; i++) {
      expect(await limit("signInEmail", "ada@example.com", NOW)).toEqual({ ok: true });
    }
    expect(await limit("signInEmail", "ADA@example.com", NOW)).toEqual({
      ok: false,
      retryAfterSeconds: 420,
    });
    // Another inbox, another bucket, and the next window, are unaffected.
    expect((await limit("signInEmail", "bola@example.com", NOW)).ok).toBe(true);
    expect((await limit("signInIp", "ada@example.com", NOW)).ok).toBe(true);
    expect(
      (await limit("signInEmail", "ada@example.com", new Date("2026-10-05T10:10:00Z"))).ok,
    ).toBe(true);
  });

  it("store an HMAC of the caller, never the email or IP address itself", async () => {
    const limit = createRateLimiter({ sql: () => sql, secret: "test-secret" });
    await limit("webhook", "102.89.34.5", NOW);
    const { rows } = await db.query<{ key: string }>("select key from public.rate_limits");
    expect(rows.length).toBeGreaterThan(0);
    for (const { key } of rows) {
      expect(key).not.toContain("@");
      expect(key).not.toContain("102.89");
      expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
  });

  it("let requests through (and report it) if the database is down", async () => {
    const onError = vi.fn();
    const limit = createRateLimiter({
      sql: () => {
        throw new Error("no database");
      },
      secret: "s",
      onError,
    });
    expect(await limit("signInIp", "1.2.3.4", NOW)).toEqual({ ok: true });
    expect(onError).toHaveBeenCalledOnce();
  });

  it("answer 429 with Retry-After", async () => {
    const res = tooManyRequests({ ok: false, retryAfterSeconds: 42 });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("42");
  });

  it("can't be read or written by signed-in users or the anon key", async () => {
    for (const role of ["anon", "authenticated"]) {
      await expect(
        db.transaction(async (tx) => {
          await tx.exec(`set local role ${role}`);
          await tx.query("select public.rate_limit_hit('signInIp', 'x', now())");
        }),
      ).rejects.toThrow(/permission denied/);
      const visible = await db.transaction(async (tx) => {
        await tx.exec(`set local role ${role}`);
        return (await tx.query("select * from public.rate_limits")).rows.length;
      });
      expect(visible).toBe(0); // RLS on, no policies
    }
  });
});

describe("the health check", () => {
  const configured = () => ({ stripe: true });

  it("is ok with the database up, and down without it", async () => {
    expect(await checkHealth({ sql: () => sql, now: NOW, detailed: false, configured })).toEqual({
      ok: true,
      database: "ok",
    });
    const down = await checkHealth({
      sql: () => {
        throw new Error("no database");
      },
      now: NOW,
      detailed: true,
      configured,
    });
    expect(down).toEqual({ ok: false, database: "down" });
  });

  it("raises the alarm, with the cron secret, when a payment webhook is stuck", async () => {
    const detailed = () => checkHealth({ sql: () => sql, now: NOW, detailed: true, configured });
    expect(await detailed()).toMatchObject({
      ok: true,
      problems: [],
      configured: { stripe: true },
    });
    await db.query(
      `insert into public.billing_events (provider, event_id, event_type, occurred_at, received_at, payload)
       values ('stripe', 'evt_stuck', 'invoice.paid', $1, $1, '{}')`,
      [new Date(NOW.getTime() - 30 * 60_000)],
    );
    expect(await detailed()).toMatchObject({
      ok: false,
      backlog: { paymentEventsStuck: 1 },
      problems: ["1 payment webhook(s) stuck"],
    });
  });
});
