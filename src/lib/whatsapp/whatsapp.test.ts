import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { questionMessages } from "./bot";
import { parseReply, parseText, replyIds } from "./commands";
import { assertValid, toCloudPayload, truncate } from "./messages";
import { cloudTransport } from "./outbox";
import type { Question, Session } from "./repo";
import { fakeWebhookBody, parseInbound, verifyMetaSignature } from "./webhook";
import { canSendFreeform } from "./window";

const SESSION = "6f1d6c2e-8a51-4f0e-9d3a-2b7c1e4f5a60";
const STUDENT = "0b9a8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d";

describe("verifyMetaSignature", () => {
  const body = '{"entry":[]}';
  const sign = (secret: string) =>
    `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

  it("accepts Meta's HMAC-SHA256 of the raw body and rejects anything else", () => {
    expect(verifyMetaSignature(body, sign("app-secret"), "app-secret")).toBe(true);
    expect(verifyMetaSignature(body, sign("other"), "app-secret")).toBe(false);
    expect(verifyMetaSignature(body + " ", sign("app-secret"), "app-secret")).toBe(false);
    expect(verifyMetaSignature(body, null, "app-secret")).toBe(false);
    expect(verifyMetaSignature(body, "sha1=abc", "app-secret")).toBe(false);
  });
});

describe("parseInbound", () => {
  const at = new Date("2026-10-05T08:00:00Z");

  it("reads text, button and list replies, and template quick replies", () => {
    expect(
      parseInbound(
        fakeWebhookBody({ id: "w1", from: "+2348031234567", sentAt: at, text: "START" }),
      ),
    ).toEqual([
      { id: "w1", from: "+2348031234567", sentAt: at.toISOString(), kind: "text", text: "START" },
    ]);
    const list = parseInbound(
      fakeWebhookBody({
        id: "w2",
        from: "2348031234567",
        sentAt: at,
        reply: { id: "pick:x", title: "Ada O.", kind: "list" },
      }),
    );
    expect(list[0]).toMatchObject({ kind: "reply", replyId: "pick:x", from: "+2348031234567" });
    const template = {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    id: "w3",
                    from: "234803",
                    timestamp: "1",
                    type: "button",
                    button: { payload: "START", text: "Start" },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    expect(parseInbound(template)[0]).toMatchObject({ kind: "reply", replyId: "START" });
  });

  it("skips statuses and junk, and marks media as other", () => {
    expect(
      parseInbound({ entry: [{ changes: [{ value: { statuses: [{ id: "s" }] } }] }] }),
    ).toEqual([]);
    expect(parseInbound("nonsense")).toEqual([]);
    const image = {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [{ id: "w4", from: "234", timestamp: "1", type: "image" }, { bad: true }],
              },
            },
          ],
        },
      ],
    };
    expect(parseInbound(image)).toEqual([expect.objectContaining({ id: "w4", kind: "other" })]);
  });
});

describe("commands", () => {
  it("understands commands, STOP variants and answer letters", () => {
    expect(parseText(" start! ")).toEqual({ type: "command", command: "START" });
    expect(parseText("Unsubscribe")).toEqual({ type: "command", command: "STOP" });
    expect(parseText("stop all")).toEqual({ type: "command", command: "STOP" });
    expect(parseText("b)")).toEqual({ type: "answer", option: 1 });
    expect(parseText("(C")).toEqual({ type: "answer", option: 2 });
    expect(parseText("hello there")).toEqual({ type: "unknown" });
  });

  it("round-trips every reply id and rejects forged ones", () => {
    expect(parseReply(replyIds.command("LEAGUE"))).toEqual({ type: "command", command: "LEAGUE" });
    expect(parseReply("START")).toEqual({ type: "command", command: "START" });
    expect(parseReply(replyIds.pick(STUDENT))).toEqual({ type: "pick", studentId: STUDENT });
    expect(parseReply(replyIds.answer(SESSION, 3, 2))).toEqual({
      type: "answerReply",
      sessionId: SESSION,
      position: 3,
      option: 2,
    });
    expect(parseReply(replyIds.next(SESSION, 9))).toEqual({
      type: "next",
      sessionId: SESSION,
      position: 9,
    });
    expect(parseReply(replyIds.explainAgain(SESSION, 0))).toEqual({
      type: "explainAgain",
      sessionId: SESSION,
      position: 0,
    });
    expect(parseReply("pick:'; drop table students; --")).toEqual({ type: "unknown" });
    expect(parseReply("cmd:DELETE")).toEqual({ type: "unknown" });
  });
});

describe("outbound messages", () => {
  const session: Session = {
    id: SESSION,
    question_ids: ["q1", "q2"],
    position: 0,
    awaiting: "answer",
    completed_at: null,
  };
  const question = (options: string[], stem = "What is 2 + 2?"): Question => ({
    id: "q1",
    stem,
    options,
    answer_index: 0,
    explanation_en: "x",
    explanation_pcm: null,
    subject: "mathematics",
    topic: "Arithmetic",
  });

  it("uses reply buttons when 3 short options fit, otherwise a list", () => {
    const short = questionMessages(question(["4", "5", "6"]), session, 0);
    expect(short).toHaveLength(1);
    expect(short[0]).toMatchObject({
      kind: "buttons",
      buttons: [{ title: "A) 4" }, { title: "B) 5" }, { title: "C) 6" }],
    });
    const four = questionMessages(question(["4", "5", "6", "7"]), session, 0);
    expect(four[0]!.kind).toBe("list");
    const long = questionMessages(
      question(["A very long option that cannot fit a row title", "b", "c"]),
      session,
      0,
    );
    expect(long[0]).toMatchObject({ kind: "list" });
    for (const m of [...short, ...four, ...long]) expect(() => assertValid(m)).not.toThrow();
  });

  it("splits a question too long for an interactive body into text plus choices", () => {
    const messages = questionMessages(question(["4", "5", "6", "7"], "x".repeat(1000)), session, 1);
    expect(messages.map((m) => m.kind)).toEqual(["text", "list"]);
    expect(messages[1]).toMatchObject({ text: expect.stringContaining("Question 2 of 2") });
  });

  it("refuses messages that break WhatsApp's limits", () => {
    const button = { id: "a", title: "ok" };
    expect(() =>
      assertValid({ kind: "buttons", text: "x", buttons: [button, button, button, button] }),
    ).toThrow(/1-3/);
    expect(() =>
      assertValid({
        kind: "buttons",
        text: "x",
        buttons: [{ id: "a", title: "This title is far too long" }],
      }),
    ).toThrow(/too long/);
    expect(() => assertValid({ kind: "list", text: "x", button: "Choose", rows: [] })).toThrow(
      /1-10/,
    );
    expect(() => assertValid({ kind: "text", text: "  " })).toThrow(/empty/);
    expect(truncate("abcdef", 4)).toBe("abc…");
  });

  it("builds Cloud API payloads", () => {
    expect(toCloudPayload("+2348031234567", { kind: "text", text: "hi" })).toMatchObject({
      to: "2348031234567",
      type: "text",
      text: { body: "hi" },
    });
    expect(
      toCloudPayload("+1", { kind: "template", name: "kinprep_morning", language: "en" }),
    ).toMatchObject({
      type: "template",
      template: { name: "kinprep_morning", language: { code: "en" } },
    });
    expect(
      toCloudPayload("+1", {
        kind: "list",
        text: "t",
        button: "b",
        rows: [{ id: "r", title: "R" }],
      }),
    ).toMatchObject({
      interactive: { type: "list", action: { button: "b", sections: [{ rows: [{ id: "r" }] }] } },
    });
  });

  it("sends through the Graph API and surfaces Meta's errors", async () => {
    const calls: [string, RequestInit][] = [];
    const ok = cloudTransport({
      accessToken: "token",
      phoneNumberId: "123",
      graphVersion: "v23.0",
      fetch: (async (url: string, init: RequestInit) => {
        calls.push([url, init]);
        return new Response(JSON.stringify({ messages: [{ id: "wamid.1" }] }));
      }) as typeof fetch,
    });
    expect(await ok.send("+2348031234567", { kind: "text", text: "hi" })).toBe("wamid.1");
    expect(calls[0]![0]).toBe("https://graph.facebook.com/v23.0/123/messages");
    const failing = cloudTransport({
      accessToken: "t",
      phoneNumberId: "1",
      graphVersion: "v23.0",
      fetch: (async () =>
        new Response(JSON.stringify({ error: { message: "Re-engagement message" } }), {
          status: 400,
        })) as unknown as typeof fetch,
    });
    await expect(failing.send("+1", { kind: "text", text: "hi" })).rejects.toThrow(/Re-engagement/);
  });
});

describe("canSendFreeform", () => {
  const now = new Date("2026-10-05T12:00:00Z");
  it("is true only within 24 hours of the contact's last message", () => {
    expect(canSendFreeform({ lastInboundAt: new Date("2026-10-04T12:00:01Z") }, now)).toBe(true);
    expect(canSendFreeform({ lastInboundAt: new Date("2026-10-04T12:00:00Z") }, now)).toBe(false);
    expect(canSendFreeform({ lastInboundAt: null }, now)).toBe(false);
    expect(canSendFreeform({ lastInboundAt: new Date("2026-10-06T00:00:00Z") }, now)).toBe(false);
  });
});
