import { reportError } from "@/lib/monitoring/report";
import type { Sql } from "@/lib/db/sql";
import { handleInbound, type BotDeps } from "./bot";
import type { InboundMessage } from "./webhook";

// The inbound job table. The webhook stores messages and answers Meta at once; processing happens
// after. Meta retries reuse the message id, which is the primary key, so nothing is handled twice.

const MAX_ATTEMPTS = 5;

/** Stores new messages; returns how many were new (retries and duplicates count zero). */
export async function enqueueInbound(
  sql: Sql,
  messages: InboundMessage[],
  simulated = false,
): Promise<number> {
  let added = 0;
  for (const m of messages) {
    const rows = await sql.query(
      `insert into public.wa_jobs (message_id, phone, message, sent_at, simulated)
       values ($1, $2, $3::jsonb, $4, $5)
       on conflict (message_id) do nothing
       returning message_id`,
      [m.id, m.from, JSON.stringify(m), m.sentAt, simulated],
    );
    added += rows.length;
  }
  return added;
}

type Job = {
  message_id: string;
  message: InboundMessage | string;
  simulated: boolean;
  attempts: number;
};

/**
 * Claims the next job. A number's messages are handled one at a time and in the order sent, so two
 * quick taps can't race each other. A claim older than 2 minutes is treated as abandoned.
 */
async function claim(sql: Sql, phone?: string): Promise<Job | null> {
  const [job] = await sql.query<Job>(
    `update public.wa_jobs j set status = 'processing', attempts = j.attempts + 1, claimed_at = now()
     where j.message_id = (
       select p.message_id from public.wa_jobs p
       where (p.status = 'pending' or (p.status = 'processing' and p.claimed_at < now() - interval '2 minutes'))
         and p.attempts < $1
         and ($2::text is null or p.phone = $2)
         and not exists (
           select 1 from public.wa_jobs q
           where q.phone = p.phone and q.message_id <> p.message_id
             and ((q.status = 'processing' and q.claimed_at >= now() - interval '2 minutes')
               or (q.status in ('pending', 'processing') and q.attempts < $1 and q.sent_at < p.sent_at))
         )
       order by p.sent_at
       limit 1
       for update skip locked
     )
     returning j.message_id, j.message, j.simulated, j.attempts`,
    [MAX_ATTEMPTS, phone ?? null],
  );
  return job ?? null;
}

/** Processes pending jobs until none are left (or `limit` is reached). Returns how many ran. */
export async function processJobs(
  sql: Sql,
  depsFor: (job: { simulated: boolean }) => Omit<BotDeps, "sql" | "now">,
  options: { limit?: number; phone?: string; now?: () => Date } = {},
): Promise<number> {
  let processed = 0;
  while (processed < (options.limit ?? 50)) {
    const job = await claim(sql, options.phone);
    if (!job) break;
    processed += 1;
    const message =
      typeof job.message === "string" ? (JSON.parse(job.message) as InboundMessage) : job.message;
    try {
      await handleInbound(message, {
        ...depsFor(job),
        sql,
        now: options.now?.() ?? new Date(),
        simulated: job.simulated,
      });
      await sql.query(
        "update public.wa_jobs set status = 'done', processed_at = now(), error = null where message_id = $1",
        [job.message_id],
      );
    } catch (error) {
      await reportError({ where: "whatsapp:job", error, tags: { attempt: String(job.attempts) } });
      await sql.query("update public.wa_jobs set status = $2, error = $3 where message_id = $1", [
        job.message_id,
        job.attempts >= MAX_ATTEMPTS ? "failed" : "pending",
        String(error).slice(0, 1000),
      ]);
      // Retry on the next run rather than hammering a failing job now.
      break;
    }
  }
  return processed;
}
