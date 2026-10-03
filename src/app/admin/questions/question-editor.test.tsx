import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { QuestionEditor, type EditorQuestion } from "./question-editor";

// The editor renders the live preview from the same code students get: the bot's WhatsApp
// messages and the web practice page's HTML.

const topics = [
  { id: "0b9a8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d", subject: "mathematics" as const, name: "Algebra" },
];
const question = (o: Partial<EditorQuestion> = {}): EditorQuestion => ({
  topicId: topics[0]!.id,
  stem: "Solve 3x = 12. What is x?",
  options: ["4", "3", "12", "36"],
  answerIndex: 0,
  explanationEn: "Divide both sides by 3: x = 4.",
  explanationPcm: "Divide both side by 3: x na 4.",
  classes: ["SS1", "SS2"],
  syllabusRef: "",
  originalConfirmed: false,
  source: "human",
  status: "draft",
  ...o,
});
const render = (initial: EditorQuestion | null) =>
  renderToStaticMarkup(
    <QuestionEditor topics={topics} initial={initial} action={async () => ({})} />,
  );

describe("the question editor", () => {
  it("previews the question as the bot sends it and as the web page shows it", () => {
    const html = render(question());
    // WhatsApp: four options don't fit three buttons, so they come as a list, like the bot.
    expect(html).toContain("Question 3 of 10 · Mathematics");
    expect(html).toContain("☰ Choose answer");
    expect(html).toContain("A) 4");
    // Web page: the practice page's own HTML, in a sandboxed frame.
    expect(html).toMatch(/<iframe[^>]+sandbox=""/);
    expect(html).toContain("Solve 3x = 12. What is x?");
    expect(html).toContain("Original question, not from a past paper");
  });

  it("asks a reviewer to confirm the answer and the explanation of an AI draft", () => {
    const ai = render(question({ source: "ai_draft" }));
    expect(ai).toContain("I have checked the answer is right");
    expect(ai).toContain("I have checked both explanations");
    expect(render(question())).not.toContain("I have checked the answer is right");
  });

  it("waits for a question and two options before previewing", () => {
    expect(render(null)).toContain("Write the question, at least two options");
  });
});
