// KinPrep's outbound message shapes, kept within WhatsApp's limits, and their Cloud API payloads.

export const LIMITS = {
  body: 1024,
  buttons: 3,
  buttonTitle: 20,
  listButton: 20,
  listRows: 10,
  rowTitle: 24,
  rowDescription: 72,
  replyId: 256,
} as const;

export type Button = { id: string; title: string };
export type Row = { id: string; title: string; description?: string };

export type Outbound =
  | { kind: "text"; text: string }
  | { kind: "buttons"; text: string; buttons: Button[] }
  | { kind: "list"; text: string; button: string; rows: Row[] }
  | { kind: "template"; name: string; language: string };

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** Throws if a message breaks WhatsApp's limits (a bug in KinPrep, not user input). */
export function assertValid(message: Outbound): void {
  const fail = (why: string) => {
    throw new Error(`Invalid WhatsApp message: ${why}`);
  };
  if (message.kind === "template") return;
  if (!message.text.trim()) fail("empty body");
  if (message.text.length > (message.kind === "text" ? 4096 : LIMITS.body)) fail("body too long");
  if (message.kind === "buttons") {
    if (message.buttons.length < 1 || message.buttons.length > LIMITS.buttons) fail("1-3 buttons");
    for (const b of message.buttons) {
      if (b.title.length > LIMITS.buttonTitle) fail(`button title "${b.title}" too long`);
      if (b.id.length > LIMITS.replyId) fail("button id too long");
    }
  }
  if (message.kind === "list") {
    if (message.button.length > LIMITS.listButton) fail("list button too long");
    if (message.rows.length < 1 || message.rows.length > LIMITS.listRows) fail("1-10 rows");
    for (const r of message.rows) {
      if (r.title.length > LIMITS.rowTitle) fail(`row title "${r.title}" too long`);
      if ((r.description?.length ?? 0) > LIMITS.rowDescription) fail("row description too long");
    }
  }
}

/** The Cloud API request body for sending `message` to `to` (E.164). */
export function toCloudPayload(to: string, message: Outbound): Record<string, unknown> {
  const base = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: to.replace(/^\+/, ""),
  };
  switch (message.kind) {
    case "text":
      return { ...base, type: "text", text: { body: message.text, preview_url: true } };
    case "buttons":
      return {
        ...base,
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: message.text },
          action: {
            buttons: message.buttons.map((b) => ({
              type: "reply",
              reply: { id: b.id, title: b.title },
            })),
          },
        },
      };
    case "list":
      return {
        ...base,
        type: "interactive",
        interactive: {
          type: "list",
          body: { text: message.text },
          action: { button: message.button, sections: [{ title: "Options", rows: message.rows }] },
        },
      };
    case "template":
      return {
        ...base,
        type: "template",
        template: { name: message.name, language: { code: message.language } },
      };
  }
}
