import { describe, expect, it } from "vitest";
import { anthropicModel } from "./model";
import {
  checkReply,
  costUsd,
  explainPrompt,
  ExplainRequestSchema,
  wordCount,
  wrongOption,
} from "./rules";

const Q = {
  stem: "Solve 2x + 3 = 11. What is x?",
  options: ["4", "8", "11", "3"],
  answer_index: 0,
  explanation_en: "Take 3 from both sides, then halve: x = 4.",
  explanation_pcm: null,
  topic: "Linear equations",
};
const ID = "0b9a8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d";

describe("requests", () => {
  it("name one question and nothing else", () => {
    const ok = { questionId: ID, studentId: ID, language: "english", chosenOption: 1 };
    expect(ExplainRequestSchema.safeParse(ok).success).toBe(true);
    expect(ExplainRequestSchema.safeParse({ ...ok, chosenOption: null }).success).toBe(true);
    expect(ExplainRequestSchema.safeParse({ ...ok, message: "hi" }).success).toBe(false);
    expect(ExplainRequestSchema.safeParse({ ...ok, language: "en" }).success).toBe(false);
    expect(ExplainRequestSchema.safeParse({ ...ok, chosenOption: 9 }).success).toBe(false);
  });

  it("address the wrong option chosen, or none", () => {
    expect(wrongOption(Q, 2)).toBe(2);
    expect(wrongOption(Q, 0)).toBe(-1); // right
    expect(wrongOption(Q, null)).toBe(-1);
    expect(wrongOption(Q, 4)).toBe(-1); // not an option of this question
  });
});

describe("the prompt", () => {
  it("is the question and its approved explanation, in the student's language", () => {
    const en = explainPrompt(Q, "en", -1);
    expect(en.system).toContain("plain English");
    expect(en.system).toContain("The correct answer is fixed: A) 4");
    expect(en.user).toContain("why the correct answer is right");
    expect(en.user).not.toContain("The student chose");
    const pcm = explainPrompt(Q, "pcm", 3);
    expect(pcm.system).toContain("Nigerian Pidgin");
    expect(pcm.user).toContain("The student chose D) 3");
  });
});

describe("reply checks", () => {
  it("pass a short explanation that keeps the answer", () => {
    expect(checkReply("  Take away 3 first.\n\n\n\nThen halve. The answer is A.  ", Q)).toEqual({
      ok: true,
      text: "Take away 3 first.\n\nThen halve. The answer is A.",
    });
    expect(checkReply("Di ansa na A: comot 3, halve am.", Q).ok).toBe(true);
    expect(checkReply("Between 3 and 12 apples, 2 - 3 - 4 - 5 - 6 - 7 steps.", Q).ok).toBe(true);
  });

  it("stop a reply that names another answer, in English or Pidgin", () => {
    expect(checkReply("The correct option is C, because 11 is the total.", Q)).toEqual({
      ok: false,
      reason: "names a different answer",
    });
    expect(checkReply("Di ansa na B.", Q).ok).toBe(false);
    expect(checkReply("So the answer is (B).", Q).ok).toBe(false);
  });

  it("stop links, emails and phone numbers, empty and over-long replies", () => {
    expect(checkReply("Read www.example.com", Q)).toMatchObject({
      reason: "contains a link or contact details",
    });
    expect(checkReply("Email help@school.ng", Q).ok).toBe(false);
    expect(checkReply("Call +234 803 123 4567", Q).ok).toBe(false);
    expect(checkReply("Call 08031234567", Q).ok).toBe(false);
    expect(checkReply("   ", Q)).toEqual({ ok: false, reason: "empty" });
    expect(checkReply("word ".repeat(121), Q)).toEqual({ ok: false, reason: "too long" });
    expect(wordCount(" one  two\nthree ")).toBe(3);
  });
});

describe("cost", () => {
  it("is tokens times the model's price per million", () => {
    expect(costUsd("claude-sonnet-5-5", 400, 90)).toBe(0.00255);
    expect(costUsd("claude-haiku-4-5-20251001", 1_000_000, 0)).toBe(1);
    expect(costUsd("some-new-model", 400, 90)).toBe(0.00255); // default price
  });
});

describe("the Anthropic client", () => {
  it("sends the prompt and reads the text and token counts", async () => {
    let sent: Record<string, unknown> = {};
    const model = anthropicModel({
      apiKey: "sk-ant-test",
      model: "claude-sonnet-5-5",
      fetch: (async (_url: string, init: RequestInit) => {
        sent = JSON.parse(String(init.body));
        return new Response(
          JSON.stringify({
            model: "claude-sonnet-5-5",
            content: [
              { type: "text", text: "Take away 3. " },
              { type: "text", text: "Halve it." },
            ],
            usage: { input_tokens: 321, output_tokens: 45 },
          }),
        );
      }) as typeof fetch,
    });
    expect(await model.complete({ system: "s", user: "u" })).toEqual({
      text: "Take away 3. \nHalve it.",
      model: "claude-sonnet-5-5",
      inputTokens: 321,
      outputTokens: 45,
    });
    expect(sent).toMatchObject({
      system: "s",
      messages: [{ role: "user", content: "u" }],
      max_tokens: 400,
    });
    const failing = anthropicModel({
      apiKey: "k",
      model: "m",
      fetch: (async () =>
        new Response(JSON.stringify({ error: { message: "rate limited" } }), {
          status: 429,
        })) as unknown as typeof fetch,
    });
    await expect(failing.complete({ system: "s", user: "u" })).rejects.toThrow(/rate limited/);
  });
});
