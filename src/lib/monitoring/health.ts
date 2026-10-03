import type { Sql } from "@/lib/db/sql";

// /api/health, for the uptime check (.github/workflows/uptime.yml) and anyone watching the site.
// Anyone gets "is the database reachable"; with the cron secret it also checks the webhook and
// message backlogs, so a webhook that keeps failing raises the alarm (Phase 12).

export type Backlog = {
  /** Payment webhooks stored but not processed 15+ minutes later (last 24 hours). */
  paymentEventsStuck: number;
  /** Inbound WhatsApp messages that failed, or are stuck 15+ minutes (last 24 hours). */
  whatsappJobsFailed: number;
  whatsappJobsStuck: number;
  /** Outbound messages that failed for good (last 24 hours). */
  outboundFailed: number;
};

export async function backlog(sql: Sql, now: Date): Promise<Backlog> {
  const [row] = await sql.query<Backlog>(
    `select
       (select count(*)::int from public.billing_events
        where processed_at is null and received_at between $1::timestamptz - interval '24 hours'
                                                        and $1::timestamptz - interval '15 minutes')
         as "paymentEventsStuck",
       (select count(*)::int from public.wa_jobs
        where status = 'failed' and received_at > $1::timestamptz - interval '24 hours')
         as "whatsappJobsFailed",
       (select count(*)::int from public.wa_jobs
        where status in ('pending', 'processing')
          and received_at between $1::timestamptz - interval '24 hours'
                              and $1::timestamptz - interval '15 minutes')
         as "whatsappJobsStuck",
       (select count(*)::int from public.outbound_queue
        where not dry_run and status = 'failed' and created_at > $1::timestamptz - interval '24 hours')
         as "outboundFailed"`,
    [now],
  );
  return row!;
}

/** Problems worth an alert, in plain words; empty if all is well. */
export function backlogProblems(b: Backlog): string[] {
  const problems: string[] = [];
  if (b.paymentEventsStuck > 0) problems.push(`${b.paymentEventsStuck} payment webhook(s) stuck`);
  if (b.whatsappJobsFailed > 0) problems.push(`${b.whatsappJobsFailed} WhatsApp message(s) failed`);
  if (b.whatsappJobsStuck > 0) problems.push(`${b.whatsappJobsStuck} WhatsApp message(s) stuck`);
  // Some failed sends are normal (a number not on WhatsApp); many are not.
  if (b.outboundFailed >= 10) problems.push(`${b.outboundFailed} outbound messages failed today`);
  return problems;
}

export type Health = {
  ok: boolean;
  database: "ok" | "down";
  backlog?: Backlog;
  problems?: string[];
  configured?: Record<string, boolean>;
};

export async function checkHealth(deps: {
  sql: () => Sql;
  now: Date;
  detailed: boolean;
  configured: () => Record<string, boolean>;
}): Promise<Health> {
  let sql: Sql;
  try {
    sql = deps.sql();
    await sql.query("select 1");
  } catch {
    return { ok: false, database: "down" };
  }
  if (!deps.detailed) return { ok: true, database: "ok" };
  const b = await backlog(sql, deps.now);
  const problems = backlogProblems(b);
  return {
    ok: problems.length === 0,
    database: "ok",
    backlog: b,
    problems,
    configured: deps.configured(),
  };
}
