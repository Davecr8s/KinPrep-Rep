import { describe, expect, it } from "vitest";
import { anthropicDrafter, DraftError, draftPrompt, parseDrafts } from "./llm";
import {
  csvField,
  importRows,
  lowCorrectRates,
  parseCsv,
  QuestionInputSchema,
  toCsv,
  type QuestionStats,
} from "./rules";

const TOPIC = "0b9a8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d";
const valid = {
  topicId: TOPIC,
  stem: "What is 2 + 2?",
  options: ["4", "5", "6", "", ""],
  answerIndex: 0,
  explanationEn: "Two and two make four.",
  explanationPcm: "",
  classes: ["SS1"],
  syllabusRef: "",
  originalConfirmed: true,
};

describe("a question", () => {
  it("needs a stem, 2-5 distinct options, a right answer among them and an English explanation", () => {
    const ok = QuestionInputSchema.parse(valid);
    expect(ok).toMatchObject({ options: ["4", "5", "6"], explanationPcm: null, syllabusRef: null });
    const problems = (o: object) =>
      QuestionInputSchema.safeParse({ ...valid, ...o }).error?.issues.map((i) => i.message);
    expect(problems({ options: ["4"] })).toContain("Give at least 2 options.");
    expect(problems({ options: ["4", "4"] })).toContain("Two options are the same.");
    expect(problems({ answerIndex: 3 })).toContain("Choose the right answer.");
    expect(problems({ explanationEn: " " })).toContain("Enter the English explanation.");
    expect(problems({ classes: [] })).toContain("Choose at least one class.");
    expect(problems({ stem: "Hm" })).toContain("Write the question.");
  });
});

describe("CSV", () => {
  it("parses quotes, doubled quotes, commas and new lines inside fields, CRLF and a BOM", () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi""\nthere"\r\n\r\n')).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"\nthere'],
    ]);
    expect(parseCsv("a,b\nc,")).toEqual([
      ["a", "b"],
      ["c", ""],
    ]);
  });

  it("quotes when needed and defuses spreadsheet formulas", () => {
    expect(csvField("plain")).toBe("plain");
    expect(csvField('a "b", c')).toBe('"a ""b"", c"');
    expect(csvField("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvField(null)).toBe("");
    expect(csvField(true)).toBe("true");
  });

  it("round-trips the export through the import", () => {
    const csv = toCsv([
      {
        id: "q1",
        subject: "mathematics",
        topic: "Algebra",
        stem: "If x = 2, what is -x + 5?",
        options: ["3", "-3", "7"],
        answerIndex: 0,
        explanationEn: "Put x = 2: -2 + 5 = 3.",
        explanationPcm: null,
        classes: ["SS1", "SS2"],
        syllabusRef: "WAEC 2.1",
        originalConfirmed: true,
        status: "approved",
        source: "human",
      },
    ]);
    const { rows, errors } = importRows(csv);
    expect(errors).toEqual([]);
    expect(csv).toContain(",yes,approved,human");
    expect(
      toCsv([
        {
          id: "q2",
          subject: "english",
          topic: "Concord",
          stem: "Pick one.",
          options: ["a", "b"],
          answerIndex: 1,
          explanationEn: "Because.",
          explanationPcm: "Na so.",
          classes: ["SS1"],
          syllabusRef: null,
          originalConfirmed: false,
          status: "draft",
          source: "import",
        },
      ]),
    ).toContain(",B,Because.,Na so.,SS1,,no,draft,import");
    expect(rows).toEqual([
      {
        line: 2,
        subject: "mathematics",
        topic: "Algebra",
        input: {
          stem: "If x = 2, what is -x + 5?",
          options: ["3", "-3", "7"],
          answerIndex: 0,
          explanationEn: "Put x = 2: -2 + 5 = 3.",
          explanationPcm: null,
          classes: ["SS1", "SS2"],
          syllabusRef: "WAEC 2.1",
          originalConfirmed: true,
        },
      },
    ]);
  });

  it("explains every row it can't import", () => {
    const header = "subject,topic,stem,option_a,option_b,answer,explanation_en";
    expect(importRows("").errors).toEqual([{ line: 1, message: "The file is empty." }]);
    expect(importRows("subject,stem\nx,y").errors[0]!.message).toMatch(/Missing columns: topic/);
    const { rows, errors } = importRows(
      [
        header,
        "maths,Algebra,What is 1+1?,1,2,B,Because.",
        "mathematics,Algebra,What is 1+1?,1,2,E,Because.",
        "mathematics,Algebra,What is 1+1?,1,2,b,Because.",
      ].join("\n"),
    );
    expect(errors).toEqual([
      { line: 2, message: 'Unknown subject "maths".' },
      { line: 3, message: "Choose the right answer." },
    ]);
    expect(rows).toHaveLength(1);
    // No classes column: every class; no original column: not confirmed.
    expect(rows[0]!.input).toMatchObject({ answerIndex: 1, originalConfirmed: false });
    expect(rows[0]!.input.classes).toHaveLength(6);
  });
});

describe("questions flagged for re-checking", () => {
  const q = (
    id: string,
    attempts: number,
    correct: number,
    chosen: number[],
    topicId = "t",
  ): QuestionStats => ({
    id,
    topicId,
    attempts,
    correct,
    chosen,
    answerIndex: 0,
  });

  it("flags a low correct rate well below the rest of the topic, and the wrong option chosen", () => {
    const flagged = lowCorrectRates([
      q("bad", 20, 3, [3, 15, 2, 0]),
      q("ok", 20, 16, [16, 2, 2, 0]),
      q("hard", 20, 5, [5, 5, 5, 5], "t2"), // low, but nothing else in its topic to compare
      q("few", 5, 0, [0, 5, 0, 0]), // too few answers to judge
    ]);
    expect(flagged).toEqual([
      { id: "bad", attempts: 20, rate: 15, topicRate: 64, popularWrong: { index: 1, share: 75 } }, // 16 of 25 others
      { id: "hard", attempts: 20, rate: 25, topicRate: null, popularWrong: null },
    ]);
  });

  it("names the most-chosen wrong option when several beat the right one", () => {
    const [flag] = lowCorrectRates([{ ...q("x", 20, 2, [2, 7, 11, 0]), topicId: "solo" }]);
    expect(flag!.popularWrong).toEqual({ index: 2, share: 55 });
    // The right answer (E) was never picked at all.
    const [none] = lowCorrectRates([
      { id: "y", topicId: "solo2", attempts: 10, correct: 0, chosen: [4, 6, 0, 0], answerIndex: 4 },
    ]);
    expect(none!.popularWrong).toEqual({ index: 1, share: 60 });
  });

  it("leaves alone a question that's only a little harder than its topic", () => {
    expect(lowCorrectRates([q("a", 20, 5, [5, 5, 5, 5]), q("b", 20, 6, [6, 5, 5, 4])])).toEqual([]);
    expect(lowCorrectRates([q("a", 20, 8, [8, 4, 4, 4])])).toEqual([]); // 40%: not low
  });
});

describe("AI drafts", () => {
  const request = {
    subject: "mathematics",
    topic: "Algebra",
    jambRef: "JAMB Algebra 2",
    waecRef: null,
    classes: ["SS1", "SS2"],
    count: 10,
    avoid: ["What is x if 2x = 4?"],
  };
  const draft = {
    stem: "Solve 3x = 12. What is x?",
    options: ["4", "3", "12", "36"],
    answer_index: 0,
    explanation_en: "Divide both sides by 3: x = 4.",
    explanation_pcm: "Divide both side by 3: x na 4.",
  };

  it("asks for originals, never past papers, in the topic and syllabus, with Pidgin", () => {
    const { system, user } = draftPrompt(request);
    expect(system).toMatch(/original/i);
    expect(system).toMatch(/past WAEC, NECO, JAMB or BECE paper/);
    expect(system).toMatch(/Nigerian Pidgin/);
    expect(user).toContain("Topic: Algebra");
    expect(user).toContain("JAMB (UTME) syllabus: JAMB Algebra 2");
    expect(user).not.toContain("WAEC (WASSCE)");
    expect(user).toContain("- What is x if 2x = 4?");
  });

  it("keeps only well-formed drafts", () => {
    expect(
      parseDrafts({
        questions: [
          draft,
          { ...draft, options: ["4", "4", "5", "6"] },
          { ...draft, answer_index: 7 },
          "junk",
        ],
      }),
    ).toEqual([draft]);
    expect(() => parseDrafts({})).toThrow(DraftError);
  });

  it("calls Anthropic's Messages API with a forced tool call", async () => {
    const calls: { url: string; body: Record<string, unknown>; headers: Record<string, string> }[] =
      [];
    const drafter = anthropicDrafter({
      apiKey: "sk-ant-test",
      model: "claude-sonnet-5-5",
      fetch: (async (url: string, init: RequestInit) => {
        calls.push({
          url,
          body: JSON.parse(String(init.body)),
          headers: init.headers as Record<string, string>,
        });
        return new Response(
          JSON.stringify({
            content: [{ type: "tool_use", name: "save_questions", input: { questions: [draft] } }],
          }),
        );
      }) as typeof fetch,
    });
    expect(await drafter.draft(request)).toEqual([draft]);
    expect(calls[0]!.url).toBe("https://api.anthropic.com/v1/messages");
    expect(calls[0]!.headers["x-api-key"]).toBe("sk-ant-test");
    expect(calls[0]!.body).toMatchObject({
      model: "claude-sonnet-5-5",
      tool_choice: { type: "tool", name: "save_questions" },
    });
    const failing = anthropicDrafter({
      apiKey: "k",
      model: "m",
      fetch: (async () =>
        new Response(JSON.stringify({ error: { message: "overloaded" } }), {
          status: 529,
        })) as unknown as typeof fetch,
    });
    await expect(failing.draft(request)).rejects.toThrow(/overloaded/);
  });
});
