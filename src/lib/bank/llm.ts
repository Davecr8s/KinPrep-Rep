import { z } from "zod";

// "Draft 10 questions for this topic": the LLM writes drafts, a teacher reviews every one. Drafts
// are saved as status draft, source ai_draft, and only approved questions reach students.
// Uses Anthropic's Messages API (LLM_API_KEY, LLM_MODEL) with a tool, so the reply is structured.

export type DraftRequest = {
  subject: string;
  topic: string;
  jambRef: string | null;
  waecRef: string | null;
  classes: readonly string[];
  count: number;
  /** Stems already in the bank for this topic, so drafts don't repeat them. */
  avoid: readonly string[];
};

export const DraftQuestionSchema = z.object({
  stem: z.string().trim().min(5).max(1000),
  options: z.array(z.string().trim().min(1).max(200)).length(4),
  answer_index: z.number().int().min(0).max(3),
  explanation_en: z.string().trim().min(5).max(1000),
  explanation_pcm: z.string().trim().min(5).max(1000),
});
export type DraftQuestion = z.infer<typeof DraftQuestionSchema>;

export interface QuestionDrafter {
  draft(request: DraftRequest): Promise<DraftQuestion[]>;
}

export class DraftError extends Error {}

export function draftPrompt(r: DraftRequest): { system: string; user: string } {
  const refs = [
    r.jambRef && `JAMB (UTME) syllabus: ${r.jambRef}`,
    r.waecRef && `WAEC (WASSCE) syllabus: ${r.waecRef}`,
  ]
    .filter(Boolean)
    .join("\n");
  return {
    system: [
      "You write practice questions for KinPrep, a daily exam-practice service for Nigerian secondary-school students (WAEC, NECO, JAMB and BECE).",
      "Rules:",
      "- Every question must be original. Never copy, adapt or paraphrase a question from a past WAEC, NECO, JAMB or BECE paper, or from a textbook.",
      "- Stay inside the topic and the syllabus reference given.",
      "- Four options, exactly one correct, all plausible; no 'all of the above' or 'none of the above'.",
      "- Plain English a 14-year-old can read. Nigerian names, places and money (naira) where a context helps.",
      "- explanation_en: two or three sentences on why the right answer is right (and, briefly, the common mistake).",
      "- explanation_pcm: the same explanation in clear Nigerian Pidgin.",
      "- No real people, brands, politics or religion.",
    ].join("\n"),
    user: [
      `Subject: ${r.subject}`,
      `Topic: ${r.topic}`,
      refs,
      `Classes: ${r.classes.join(", ")}`,
      `Write ${r.count} questions of mixed difficulty.`,
      r.avoid.length
        ? `These are already in the bank; don't repeat them:\n${r.avoid.map((s) => `- ${s}`).join("\n")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
}

const TOOL = {
  name: "save_questions",
  description: "Save the drafted multiple-choice questions.",
  input_schema: {
    type: "object",
    properties: {
      questions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            stem: { type: "string" },
            options: { type: "array", items: { type: "string" }, minItems: 4, maxItems: 4 },
            answer_index: { type: "integer", minimum: 0, maximum: 3 },
            explanation_en: { type: "string" },
            explanation_pcm: { type: "string" },
          },
          required: ["stem", "options", "answer_index", "explanation_en", "explanation_pcm"],
        },
      },
    },
    required: ["questions"],
  },
} as const;

/** Keeps the drafts that are well formed; drops the rest (a reviewer sees what's left). */
export function parseDrafts(input: unknown): DraftQuestion[] {
  const list = (input as { questions?: unknown })?.questions;
  if (!Array.isArray(list)) throw new DraftError("The AI's reply had no questions.");
  return list.flatMap((q) => {
    const parsed = DraftQuestionSchema.safeParse(q);
    if (!parsed.success) return [];
    const distinct = new Set(parsed.data.options.map((o) => o.toLowerCase())).size === 4;
    return distinct ? [parsed.data] : [];
  });
}

export function anthropicDrafter(config: {
  apiKey: string;
  model: string;
  fetch?: typeof fetch;
}): QuestionDrafter {
  const doFetch = config.fetch ?? fetch;
  return {
    async draft(request) {
      const prompt = draftPrompt(request);
      const response = await doFetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": config.apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: config.model,
          max_tokens: 8000,
          system: prompt.system,
          messages: [{ role: "user", content: prompt.user }],
          tools: [TOOL],
          tool_choice: { type: "tool", name: TOOL.name },
        }),
      });
      const json = (await response.json().catch(() => null)) as {
        content?: { type: string; input?: unknown }[];
        error?: { message?: string };
      } | null;
      if (!response.ok || !json) {
        throw new DraftError(
          `The AI request failed (${response.status}): ${json?.error?.message ?? "no reply"}`,
        );
      }
      const call = json.content?.find((c) => c.type === "tool_use");
      return parseDrafts(call?.input);
    },
  };
}
