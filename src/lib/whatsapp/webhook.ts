import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

// Meta WhatsApp Cloud API webhooks: signature check and parsing into KinPrep's inbound shape.

/** X-Hub-Signature-256 is "sha256=" + HMAC-SHA256(raw body, app secret), hex. */
export function verifyMetaSignature(
  rawBody: string,
  header: string | null,
  appSecret: string,
): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest();
  const given = Buffer.from(header.slice("sha256=".length), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export type InboundMessage = {
  id: string;
  /** E.164, e.g. +2348031234567. */
  from: string;
  sentAt: string;
  /** "text": typed; "reply": a tapped button, list row or template quick reply; "other": media etc. */
  kind: "text" | "reply" | "other";
  text?: string;
  replyId?: string;
  replyTitle?: string;
};

const MessageSchema = z.looseObject({
  id: z.string(),
  from: z.string(),
  timestamp: z.string(),
  type: z.string(),
  text: z.object({ body: z.string() }).optional(),
  button: z.object({ payload: z.string(), text: z.string().optional() }).optional(),
  interactive: z
    .looseObject({
      type: z.string(),
      button_reply: z.object({ id: z.string(), title: z.string() }).optional(),
      list_reply: z.object({ id: z.string(), title: z.string() }).optional(),
    })
    .optional(),
});

const BodySchema = z.object({
  entry: z
    .array(
      z.object({
        changes: z
          .array(
            z.object({
              value: z.looseObject({ messages: z.array(z.unknown()).optional() }),
            }),
          )
          .default([]),
      }),
    )
    .default([]),
});

/** Inbound messages in a webhook body. Delivery/read statuses and anything unparseable are skipped. */
export function parseInbound(body: unknown): InboundMessage[] {
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return [];
  const out: InboundMessage[] = [];
  for (const entry of parsed.data.entry) {
    for (const change of entry.changes) {
      for (const raw of change.value.messages ?? []) {
        const m = MessageSchema.safeParse(raw);
        if (!m.success) continue;
        const msg = m.data;
        const base = {
          id: msg.id,
          from: msg.from.startsWith("+") ? msg.from : `+${msg.from}`,
          sentAt: new Date(Number(msg.timestamp) * 1000).toISOString(),
        };
        const reply = msg.interactive?.button_reply ?? msg.interactive?.list_reply;
        if (msg.type === "text" && msg.text)
          out.push({ ...base, kind: "text", text: msg.text.body });
        else if (msg.type === "interactive" && reply)
          out.push({ ...base, kind: "reply", replyId: reply.id, replyTitle: reply.title });
        else if (msg.type === "button" && msg.button)
          out.push({
            ...base,
            kind: "reply",
            replyId: msg.button.payload,
            replyTitle: msg.button.text,
          });
        else out.push({ ...base, kind: "other" });
      }
    }
  }
  return out;
}

/** A Meta-shaped webhook body for one message; the simulator uses it so it exercises parsing too. */
export function fakeWebhookBody(message: {
  id: string;
  from: string;
  sentAt: Date;
  text?: string;
  reply?: { id: string; title: string; kind: "button" | "list" };
}): unknown {
  const base = {
    id: message.id,
    from: message.from.replace(/^\+/, ""),
    timestamp: String(Math.floor(message.sentAt.getTime() / 1000)),
  };
  const content = message.reply
    ? {
        type: "interactive",
        interactive:
          message.reply.kind === "button"
            ? {
                type: "button_reply",
                button_reply: { id: message.reply.id, title: message.reply.title },
              }
            : {
                type: "list_reply",
                list_reply: { id: message.reply.id, title: message.reply.title },
              },
      }
    : { type: "text", text: { body: message.text ?? "" } };
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "simulator",
        changes: [
          {
            field: "messages",
            value: { messaging_product: "whatsapp", messages: [{ ...base, ...content }] },
          },
        ],
      },
    ],
  };
}
