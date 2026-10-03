import { z } from "zod";
import { AI_PRICE_PER_MTOK, EXPLAIN_MAX_WORDS } from "@/config/ai";

// Pure rules for the AI "Explain another way": what a request may contain, the exact prompt
// (the question and its teacher-approved explanation, nothing about the student), and the
// checks every model reply must pass before a student sees it. Unit tested in ai.test.ts.

const LETTERS = ["A", "B", "C", "D", "E"];

/**
 * A request names one question and nothing else: no free text can reach the model. Unknown
 * fields (a "message", a "prompt") make the request invalid, not ignored.
 */
export const ExplainRequestSchema = z
  .object({
    questionId: z.uuid(),
    studentId: z.uuid(),
    language: z.enum(["english", "pidgin"]),
    /** The option the student chose (0 = A), or null if they haven't answered. */
    chosenOption: z.number().int().min(0).max(4).nullable(),
  })
  .strict();
export type ExplainRequest = z.infer<typeof ExplainRequestSchema>;

export type ExplainQuestion = {
  stem: string;
  options: string[];
  answer_index: number;
  explanation_en: string;
  explanation_pcm: string | null;
  topic: string;
};

/** The wrong option to address, or -1 (answered right, or not answered). The cache key uses it. */
export function wrongOption(
  q: Pick<ExplainQuestion, "answer_index" | "options">,
  chosen: number | null,
): number {
  return chosen === null || chosen === q.answer_index || chosen >= q.options.length ? -1 : chosen;
}

/** The prompt: only the question, its options, the right answer, the approved explanation, the topic. */
export function explainPrompt(
  q: ExplainQuestion,
  language: "en" | "pcm",
  wrong: number,
): { system: string; user: string } {
  const answer = `${LETTERS[q.answer_index]}) ${q.options[q.answer_index]}`;
  return {
    system: [
      "You help a Nigerian secondary-school student understand one practice question they have just answered.",
      "Explain the same question another way: a different angle, a simple example or a short step-by-step, not a repeat of the teacher's explanation.",
      `The correct answer is fixed: ${answer}. Never say any other option is correct, and never question the answer.`,
      `Use under ${EXPLAIN_MAX_WORDS - 20} words, plain words a 14-year-old understands, no headings, no lists longer than four steps.`,
      language === "pcm" ? "Write in clear Nigerian Pidgin." : "Write in plain English.",
      "Talk only about this question and its topic. Do not greet the student, use names, ask questions, give links or mention yourself.",
    ].join("\n"),
    user: [
      `Topic: ${q.topic}`,
      `Question: ${q.stem}`,
      `Options:\n${q.options.map((o, i) => `${LETTERS[i]}) ${o}`).join("\n")}`,
      `Correct answer: ${answer}`,
      `Teacher's explanation: ${q.explanation_en}`,
      wrong >= 0
        ? `The student chose ${LETTERS[wrong]}) ${q.options[wrong]}. Say briefly why that is not right, then explain the correct answer.`
        : "The student wants to understand why the correct answer is right.",
    ].join("\n\n"),
  };
}

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export type ReplyCheck = { ok: true; text: string } | { ok: false; reason: string };

/**
 * Every reply is checked before a student sees it: short enough, no links or contact details,
 * and it never names a different option as the answer. A failed check falls back to the
 * teacher's explanation and isn't cached.
 */
export function checkReply(
  reply: string,
  q: Pick<ExplainQuestion, "answer_index" | "options">,
): ReplyCheck {
  const text = reply.trim().replace(/\n{3,}/g, "\n\n");
  if (!text) return { ok: false, reason: "empty" };
  if (wordCount(text) > EXPLAIN_MAX_WORDS) return { ok: false, reason: "too long" };
  // Links, email addresses, and phone numbers (international, or a Nigerian mobile 080...).
  if (
    /https?:\/\/|www\.|@[a-z0-9-]+\.[a-z]{2,}|\+\d[\d\s-]{8,}\d|\b0[789][01]\d{8}\b/i.test(text)
  ) {
    return { ok: false, reason: "contains a link or contact details" };
  }
  const right = LETTERS[q.answer_index];
  const claimed = [
    ...text.matchAll(
      /(?:answer|correct (?:option|choice)|right (?:option|choice|answer)|ansa)\s*(?:is|na|be|:)\s*(?:option\s*)?\(?([A-E])\b/gi,
    ),
  ].map((m) => m[1]!.toUpperCase());
  if (claimed.some((letter) => letter !== right)) {
    return { ok: false, reason: "names a different answer" };
  }
  return { ok: true, text };
}

/** Estimated cost in US dollars of one model call. */
export function costUsd(model: string, inputTokens: number, outputTokens: number): number {
  const price = AI_PRICE_PER_MTOK[model] ?? AI_PRICE_PER_MTOK.default!;
  return (
    Math.round(((inputTokens * price.input + outputTokens * price.output) / 1_000_000) * 1e6) / 1e6
  );
}
