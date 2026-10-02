import { randomUUID } from "node:crypto";
import type { Sql } from "@/lib/db/sql";
import type { ExplainAnotherWay } from "@/lib/practice/explain";
import { enqueueInbound, processJobs } from "./jobs";
import type { Outbound } from "./messages";
import { createOutbox, simulatedTransport } from "./outbox";
import { fakeWebhookBody, parseInbound } from "./webhook";

// The WhatsApp simulator (/admin/dev/whatsapp, and the bot tests): fakes Meta's inbound webhook
// and runs it through the real parse -> job table -> bot path. Replies are only logged.

export type SimulatedInput = {
  phone: string;
  text?: string;
  reply?: { id: string; title: string; kind: "button" | "list" };
};

export async function simulateInbound(
  sql: Sql,
  deps: { appUrl: string; explainAnotherWay?: ExplainAnotherWay },
  input: SimulatedInput,
  now: Date = new Date(),
): Promise<void> {
  const body = fakeWebhookBody({
    id: `sim.${randomUUID()}`,
    from: input.phone,
    sentAt: now,
    text: input.text,
    reply: input.reply,
  });
  await enqueueInbound(sql, parseInbound(body), true);
  await processJobs(
    sql,
    () => ({
      outbox: createOutbox({ sql, transport: simulatedTransport(), now: () => now }),
      appUrl: deps.appUrl,
      explainAnotherWay: deps.explainAnotherWay,
    }),
    { phone: input.phone, now: () => now },
  );
}

export type LoggedMessage = {
  id: number;
  direction: "in" | "out";
  status: string;
  created_at: Date;
  /** Outbound: KinPrep's message. Inbound: the parsed inbound message. */
  body: Outbound | { kind: string; text?: string; replyTitle?: string };
};

export async function conversation(
  sql: Sql,
  phone: string,
  afterId = 0,
  limit = 200,
): Promise<LoggedMessage[]> {
  const rows = await sql.query<LoggedMessage & { body: unknown }>(
    `select id::int, direction, status, created_at, body from public.message_log
     where phone = $1 and id > $2 order by id desc limit $3`,
    [phone, afterId, limit],
  );
  return rows
    .reverse()
    .map(
      (r) =>
        ({ ...r, body: typeof r.body === "string" ? JSON.parse(r.body) : r.body }) as LoggedMessage,
    );
}

/** Test numbers: wipe today's practice and the contact's state (simulated messages only). */
export async function resetNumber(sql: Sql, phone: string): Promise<void> {
  await sql.query(
    `delete from public.practice_sessions where channel = 'whatsapp' and lagos_day is not null
       and student_id in (select id from public.students where whatsapp_number = $1)`,
    [phone],
  );
  await sql.query("delete from public.wa_contacts where phone = $1", [phone]);
  await sql.query("delete from public.message_log where phone = $1 and simulated", [phone]);
}
