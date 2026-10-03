import { randomUUID } from "node:crypto";
import type { Sql } from "@/lib/db/sql";
import { studentMessageProblem, type StudentAtNumber } from "@/lib/rules/messaging";
import { assertValid, toCloudPayload, type Outbound } from "./messages";
import { canSendFreeform } from "./window";

/** Delivers a message to WhatsApp and returns Meta's message id. */
export interface Transport {
  readonly simulated: boolean;
  send(to: string, message: Outbound): Promise<string>;
}

export function cloudTransport(config: {
  accessToken: string;
  phoneNumberId: string;
  graphVersion: string;
  fetch?: typeof fetch;
}): Transport {
  const doFetch = config.fetch ?? fetch;
  return {
    simulated: false,
    async send(to, message) {
      const response = await doFetch(
        `https://graph.facebook.com/${config.graphVersion}/${config.phoneNumberId}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(toCloudPayload(to, message)),
        },
      );
      const json = (await response.json().catch(() => null)) as {
        messages?: { id: string }[];
        error?: { message: string };
      } | null;
      if (!response.ok || !json?.messages?.[0]?.id) {
        throw new Error(
          `WhatsApp send failed (${response.status}): ${json?.error?.message ?? "no message id"}`,
        );
      }
      return json.messages[0].id;
    },
  };
}

/** For the simulator and tests: nothing leaves the server; the message log is the output. */
export function simulatedTransport(): Transport {
  return { simulated: true, send: async () => `sim.${randomUUID()}` };
}

export type SendResult = "sent" | "simulated" | "blocked" | "failed";

export type SendOptions = {
  studentId?: string | null;
  /** True for messages KinPrep starts (morning message, reports). Replies to the contact are false. */
  businessInitiated?: boolean;
  /** Logged with the send: which template, its category, the estimated cost, the queue row. */
  meta?: { template?: string; category?: string; costUsd?: number; queueId?: number };
};

export type Delivery = { status: SendResult; waId?: string; error?: string };

/**
 * The only way the bot sends anything. Enforces the WhatsApp rules (CLAUDE.md): STOP blocks every
 * business-started message, free-form messages need the 24-hour window (outside it only
 * approved templates go out), and nothing about a student goes out without guardian consent or
 * to a child under 13 (src/lib/rules/messaging.ts). Everything is written to message_log, blocked attempts included.
 */
export function createOutbox(deps: { sql: Sql; transport: Transport; now?: () => Date }) {
  const now = deps.now ?? (() => new Date());

  async function log(
    phone: string,
    message: Outbound,
    status: SendResult,
    extra: { studentId?: string | null; waId?: string; error?: string; meta?: SendOptions["meta"] },
  ) {
    await deps.sql.query(
      `insert into public.message_log
         (direction, phone, student_id, wa_message_id, kind, body, status, error, simulated,
          template, category, estimated_cost_usd, queue_id)
       values ('out', $1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12)`,
      [
        phone,
        extra.studentId ?? null,
        extra.waId ?? null,
        message.kind,
        JSON.stringify(message),
        status,
        extra.error ?? null,
        deps.transport.simulated,
        extra.meta?.template ?? null,
        extra.meta?.category ?? null,
        extra.meta?.costUsd ?? null,
        extra.meta?.queueId ?? null,
      ],
    );
  }

  /** The students this message is about or whose own number it goes to (rules/messaging.ts). */
  async function studentsAt(phone: string, studentId: string | null): Promise<StudentAtNumber[]> {
    const rows = await deps.sql.query<{
      about: boolean;
      own_number: boolean;
      senior: boolean;
      consented: boolean;
      payer_number: boolean;
    }>(
      `select coalesce(s.id = $2::uuid, false) as about,
              coalesce(s.whatsapp_number = $1, false) as own_number,
              public.is_senior_birth_year(s.birth_year, $3) as senior,
              coalesce((select c.event = 'granted' from public.guardian_consents c
                        where c.student_id = s.id order by c.created_at desc limit 1), false) as consented,
              exists (select 1 from public.payers p
                      where p.whatsapp_number = $1
                        and (p.id = s.owner_id or exists (select 1 from public.student_viewers v
                                                          where v.student_id = s.id and v.viewer_id = p.id))) as payer_number
       from public.students s
       where s.whatsapp_number = $1 or s.id = $2::uuid`,
      [phone, studentId, now()],
    );
    return rows.map((r) => ({
      about: r.about,
      ownNumber: r.own_number,
      senior: r.senior,
      consented: r.consented,
      payerNumber: r.payer_number,
    }));
  }

  async function deliver(
    phone: string,
    message: Outbound,
    options: SendOptions = {},
  ): Promise<Delivery> {
    assertValid(message);
    const [contact] = await deps.sql.query<{
      last_inbound_at: Date | null;
      opted_out_at: Date | null;
    }>("select last_inbound_at, opted_out_at from public.wa_contacts where phone = $1", [phone]);
    let blocked: string | null = null;
    if (options.businessInitiated && contact?.opted_out_at) blocked = "contact sent STOP";
    else if (
      message.kind !== "template" &&
      !canSendFreeform({ lastInboundAt: contact?.last_inbound_at ?? null }, now())
    ) {
      blocked = "outside the 24-hour window; only templates allowed";
    }
    if (!blocked) {
      blocked = studentMessageProblem(
        await studentsAt(phone, options.studentId ?? null),
        options.businessInitiated ?? false,
      );
    }
    const extra = { studentId: options.studentId, meta: options.meta };
    if (blocked) {
      await log(phone, message, "blocked", { ...extra, error: blocked });
      return { status: "blocked", error: blocked };
    }
    try {
      const waId = await deps.transport.send(phone, message);
      const status = deps.transport.simulated ? "simulated" : "sent";
      await log(phone, message, status, { ...extra, waId });
      return { status, waId };
    } catch (error) {
      await log(phone, message, "failed", { ...extra, error: String(error) });
      return { status: "failed", error: String(error) };
    }
  }

  return {
    deliver,
    async send(phone: string, message: Outbound, options: SendOptions = {}): Promise<SendResult> {
      return (await deliver(phone, message, options)).status;
    },
  };
}

export type Outbox = ReturnType<typeof createOutbox>;
