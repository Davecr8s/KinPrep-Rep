import { RETRY_BACKOFF_SECONDS, SENDING_LIMITS } from "@/config/messaging";
import type { Sql } from "@/lib/db/sql";
import type { Outbound } from "@/lib/whatsapp/messages";
import { createOutbox, type Transport } from "@/lib/whatsapp/outbox";
import { canSendFreeform } from "@/lib/whatsapp/window";
import type { EmailMessage, EmailTransport } from "./email";
import { estimateCostUsd } from "./rules";

// The outbound message queue. Jobs add messages (once each, by dedupe key); the worker sends
// them within the sending limits, retries failures with backoff, and logs every attempt with its
// template, category and estimated cost.

export type QueueJob =
  "morning" | "junior_link" | "reminder" | "missed_days" | "weekly_report" | "practice_link";

export type QueueItem = {
  job: QueueJob;
  /** One send per student (or household number, or payer) per day per job. */
  dedupeKey: string;
  channel: "whatsapp" | "email";
  recipient: string;
  studentId?: string | null;
  payerId?: string | null;
  template?: string | null;
  category: string;
  payload: Outbound | EmailMessage;
  preview: string;
  lagosDay: string;
  /** When it stops being worth sending. */
  expiresAt: Date;
};

/**
 * Adds a message unless one with the same key is already queued (or sent). True if added. A dry
 * run also counts as "already there" anything a real run has queued, so it shows exactly what a
 * real run would send now.
 */
export async function enqueue(
  sql: Sql,
  item: QueueItem,
  /** manual: for an admin to send by hand (pilot console); the worker never sends it. */
  options: { dryRun: boolean; now: Date; manual?: boolean },
): Promise<boolean> {
  if (options.dryRun) {
    const [live] = await sql.query(
      "select 1 from public.outbound_queue where dedupe_key = $1 and not dry_run",
      [item.dedupeKey],
    );
    if (live) return false;
  }
  const rows = await sql.query(
    `insert into public.outbound_queue
       (job, dedupe_key, dry_run, channel, recipient, student_id, payer_id, template, category,
        payload, preview, lagos_day, status, next_attempt_at, expires_at, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, $14, $15, $14)
     on conflict (dedupe_key, dry_run) do nothing
     returning id`,
    [
      item.job,
      item.dedupeKey,
      options.dryRun,
      item.channel,
      item.recipient,
      item.studentId ?? null,
      item.payerId ?? null,
      item.template ?? null,
      item.category,
      JSON.stringify(item.payload),
      item.preview,
      item.lagosDay,
      options.dryRun ? "dry_run" : options.manual ? "manual" : "pending",
      options.now,
      item.expiresAt,
    ],
  );
  return rows.length > 0;
}

export async function sendingLimits(sql: Sql): Promise<{ perSecond: number; perDay: number }> {
  const rows = await sql.query<{ key: string; value: unknown }>(
    "select key, value from public.settings where key in ('wa_messages_per_second', 'wa_messages_per_day')",
  );
  const read = (key: string, fallback: number, max: number) => {
    const n = Number(rows.find((r) => r.key === key)?.value);
    return Number.isFinite(n) && n > 0 ? Math.min(n, max) : fallback;
  };
  return {
    perSecond: read("wa_messages_per_second", SENDING_LIMITS.perSecond, 80),
    perDay: read("wa_messages_per_day", SENDING_LIMITS.perDay, 100_000),
  };
}

export type WorkerDeps = {
  sql: Sql;
  /** Null when WhatsApp isn't set up: WhatsApp messages wait in the queue. */
  whatsapp: Transport | null;
  /** Null when email isn't set up: emails wait in the queue. */
  email: EmailTransport | null;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  /** Stop claiming new messages after this long (default 4 minutes). */
  budgetMs?: number;
  /** Milliseconds for pacing and the time budget (default Date.now); tests pass a fake one. */
  clock?: () => number;
};

export type WorkerResult = {
  sent: number;
  blocked: number;
  retrying: number;
  failed: number;
  expired: number;
  /** Still waiting: daily limit reached, or the channel isn't set up. */
  waiting: number;
};

type Claimed = {
  id: number;
  channel: "whatsapp" | "email";
  recipient: string;
  student_id: string | null;
  template: string | null;
  category: string;
  payload: unknown;
  attempts: number;
  expires_at: Date;
};

export async function runQueue(deps: WorkerDeps): Promise<WorkerResult> {
  const { sql } = deps;
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const clock = deps.clock ?? Date.now;
  const started = clock();
  const budget = deps.budgetMs ?? 240_000;
  const limits = await sendingLimits(sql);
  const result: WorkerResult = {
    sent: 0,
    blocked: 0,
    retrying: 0,
    failed: 0,
    expired: 0,
    waiting: 0,
  };
  const outbox = deps.whatsapp ? createOutbox({ sql, transport: deps.whatsapp, now }) : null;
  let lastWhatsAppSend = -Infinity;

  const finish = async (id: number, fields: Record<string, unknown>) => {
    const keys = Object.keys(fields);
    await sql.query(
      `update public.outbound_queue set ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")} where id = $1`,
      [id, ...keys.map((k) => fields[k])],
    );
  };
  const retryOrFail = async (item: Claimed, error: string) => {
    const wait = RETRY_BACKOFF_SECONDS[item.attempts - 1];
    if (wait === undefined) {
      await finish(item.id, { status: "failed", last_error: error });
      result.failed += 1;
    } else {
      await finish(item.id, {
        status: "pending",
        last_error: error,
        next_attempt_at: new Date(now().getTime() + wait * 1000),
      });
      result.retrying += 1;
    }
  };

  while (clock() - started < budget) {
    const at = now();
    const [{ n: sentToday }] = (await sql.query<{ n: number }>(
      `select count(*)::int as n from public.outbound_queue
       where channel = 'whatsapp' and status = 'sent' and not dry_run
         and sent_at > $1::timestamptz - interval '24 hours'`,
      [at],
    )) as [{ n: number }];
    const channels = [
      ...(outbox && sentToday < limits.perDay ? ["whatsapp"] : []),
      ...(deps.email ? ["email"] : []),
    ];
    // Expired messages first: never sent late.
    const expired = await sql.query(
      `update public.outbound_queue set status = 'failed', last_error = 'expired before it could be sent'
       where not dry_run and status in ('pending', 'sending') and expires_at <= $1
       returning id`,
      [at],
    );
    result.expired += expired.length;
    const [item] = await sql.query<Claimed>(
      `update public.outbound_queue
       set status = 'sending', claimed_at = $1, attempts = attempts + 1
       where id = (
         select id from public.outbound_queue
         where not dry_run and channel = any($2::text[])
           and ((status = 'pending' and next_attempt_at <= $1)
             or (status = 'sending' and claimed_at < $1::timestamptz - interval '10 minutes'))
         order by next_attempt_at, id
         limit 1
         for update skip locked
       )
       returning id, channel, recipient, student_id::text, template, category, payload, attempts, expires_at`,
      [at, channels],
    );
    if (!item) break;

    if (item.channel === "whatsapp") {
      // Pace sends to the per-second limit.
      const gap = 1000 / limits.perSecond - (clock() - lastWhatsAppSend);
      if (gap > 0) await sleep(gap);
      lastWhatsAppSend = clock();
      const [contact] = await sql.query<{ last_inbound_at: Date | null }>(
        "select last_inbound_at from public.wa_contacts where phone = $1",
        [item.recipient],
      );
      const costUsd = estimateCostUsd({
        channel: "whatsapp",
        recipient: item.recipient,
        category: item.category,
        windowOpen: canSendFreeform({ lastInboundAt: contact?.last_inbound_at ?? null }, at),
      });
      const delivery = await outbox!.deliver(item.recipient, item.payload as Outbound, {
        studentId: item.student_id,
        businessInitiated: true,
        meta: {
          template: item.template ?? undefined,
          category: item.category,
          costUsd,
          queueId: item.id,
        },
      });
      if (delivery.status === "sent" || delivery.status === "simulated") {
        await finish(item.id, {
          status: "sent",
          sent_at: now(),
          provider_message_id: delivery.waId ?? null,
          estimated_cost_usd: costUsd,
          last_error: null,
        });
        result.sent += 1;
      } else if (delivery.status === "blocked") {
        await finish(item.id, { status: "blocked", last_error: delivery.error ?? "blocked" });
        result.blocked += 1;
      } else {
        await retryOrFail(item, delivery.error ?? "send failed");
      }
      continue;
    }

    const email = item.payload as EmailMessage;
    try {
      const id = await deps.email!.send(email);
      await logEmail(sql, item, "sent", deps.email!.simulated, id);
      await finish(item.id, {
        status: "sent",
        sent_at: now(),
        provider_message_id: id,
        estimated_cost_usd: 0,
        last_error: null,
      });
      result.sent += 1;
    } catch (error) {
      await logEmail(sql, item, "failed", deps.email!.simulated, null, String(error));
      await retryOrFail(item, String(error));
    }
  }

  const [{ n: waiting }] = (await sql.query<{ n: number }>(
    "select count(*)::int as n from public.outbound_queue where not dry_run and status in ('pending', 'sending')",
  )) as [{ n: number }];
  result.waiting = waiting;
  return result;
}

async function logEmail(
  sql: Sql,
  item: Claimed,
  status: "sent" | "failed",
  simulated: boolean,
  providerId: string | null,
  error?: string,
) {
  await sql.query(
    `insert into public.message_log
       (direction, email, student_id, wa_message_id, kind, body, status, error, simulated,
        template, category, estimated_cost_usd, queue_id)
     values ('out', $1, $2, $3, 'email', $4::jsonb, $5, $6, $7, null, 'email', 0, $8)`,
    [
      item.recipient,
      item.student_id,
      providerId,
      JSON.stringify(item.payload),
      simulated && status === "sent" ? "simulated" : status,
      error ?? null,
      simulated,
      item.id,
    ],
  );
}
