import type { Question } from "./repo";

/**
 * "Explain another way" for the current question only (CLAUDE.md: the AI never chats freely).
 * The AI version comes with Prompt 10 / Phase 7; until then this uses the teacher-written
 * explanation in the student's other language.
 */
export type ExplainAnotherWay = (input: {
  question: Question;
  language: "en" | "pcm";
}) => Promise<string>;

export const prewrittenAlternative: ExplainAnotherWay = async ({ question, language }) => {
  const letter = String.fromCharCode(65 + question.answer_index);
  const answer = `${letter}) ${question.options[question.answer_index]}`;
  if (language === "en" && question.explanation_pcm) {
    return `Here it is in Pidgin:\n\n${question.explanation_pcm}`;
  }
  if (language === "pcm" && question.explanation_pcm) {
    return `Here it is in English:\n\n${question.explanation_en}`;
  }
  return `The answer is ${answer}.\n\nThink of it this way: ${question.explanation_en}`;
};
