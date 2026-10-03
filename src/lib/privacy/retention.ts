import { RETENTION_DAYS } from "@/config/security";
import type { Sql } from "@/lib/db/sql";

// The daily maintenance job (/api/jobs/maintenance, 03:00 Lagos): deletes operational data that
// is past its retention period (src/config/security.ts) and spent rate-limit counters. Safe to
// run twice.

export type PurgeResult = Record<
  "messageLog" | "waJobs" | "outboundQueue" | "dryRuns" | "billingPayloads" | "rateLimits",
  number
>;

export async function purgeExpired(sql: Sql, now: Date): Promise<PurgeResult> {
  const before = (days: number) => new Date(now.getTime() - days * 86_400_000);
  const count = async (query: string, params: unknown[]) =>
    (await sql.query(`${query} returning 1`, params)).length;
  return {
    messageLog: await count("delete from public.message_log where created_at < $1", [
      before(RETENTION_DAYS.messageLog),
    ]),
    waJobs: await count(
      "delete from public.wa_jobs where status in ('done', 'failed') and received_at < $1",
      [before(RETENTION_DAYS.waJobs)],
    ),
    outboundQueue: await count(
      `delete from public.outbound_queue
       where not dry_run and status not in ('pending', 'sending') and created_at < $1`,
      [before(RETENTION_DAYS.outboundQueue)],
    ),
    dryRuns: await count("delete from public.outbound_queue where dry_run and created_at < $1", [
      before(RETENTION_DAYS.dryRuns),
    ]),
    // Keep the row (its id makes webhooks idempotent); drop the payload, which names the payer.
    billingPayloads: await count(
      `update public.billing_events set payload = '{}'::jsonb
       where processed_at is not null and received_at < $1 and payload <> '{}'::jsonb`,
      [before(RETENTION_DAYS.billingEvents)],
    ),
    // Every window is at most a day long.
    rateLimits: await count("delete from public.rate_limits where window_start < $1", [before(1)]),
  };
}
