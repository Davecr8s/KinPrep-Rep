import { randomUUID } from "node:crypto";
import type { Sql } from "@/lib/db/sql";
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
  /** True for messages KinPrep starts (morning nudge). Replies to the contact are false. */
  businessInitiated?: boolean;
};

/**
 * The only way the bot sends anything. Enforces the WhatsApp rules (CLAUDE.md): STOP blocks every
 * business-started message, and free-form messages need the 24-hour window; outside it only
 * approved templates go out. Everything is written to message_log, blocked attempts included.
 */
export function createOutbox(deps: { sql: Sql; transport: Transport; now?: () => Date }) {
  const now = deps.now ?? (() => new Date());

  async function log(
    phone: string,
    message: Outbound,
    status: SendResult,
    extra: { studentId?: string | null; waId?: string; error?: string },
  ) {
    await deps.sql.query(
      `insert into public.message_log (direction, phone, student_id, wa_message_id, kind, body, status, error, simulated)
       values ('out', $1, $2, $3, $4, $5::jsonb, $6, $7, $8)`,
      [
        phone,
        extra.studentId ?? null,
        extra.waId ?? null,
        message.kind,
        JSON.stringify(message),
        status,
        extra.error ?? null,
        deps.transport.simulated,
      ],
    );
  }

  return {
    async send(phone: string, message: Outbound, options: SendOptions = {}): Promise<SendResult> {
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
      if (blocked) {
        await log(phone, message, "blocked", { studentId: options.studentId, error: blocked });
        return "blocked";
      }
      try {
        const waId = await deps.transport.send(phone, message);
        const status = deps.transport.simulated ? "simulated" : "sent";
        await log(phone, message, status, { studentId: options.studentId, waId });
        return status;
      } catch (error) {
        await log(phone, message, "failed", { studentId: options.studentId, error: String(error) });
        return "failed";
      }
    },
  };
}

export type Outbox = ReturnType<typeof createOutbox>;
