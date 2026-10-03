import { SUBJECT_LABELS } from "@/lib/labels";
import type { Question, Session } from "@/lib/practice/repo";
import { replyIds } from "./commands";
import { LIMITS, truncate, type Outbound } from "./messages";

// How a question and its marking look on WhatsApp. Pure, so the bot sends exactly what the
// question editor's preview shows (/admin/questions).

export const LETTERS = ["A", "B", "C", "D", "E"];
const text = (t: string): Outbound => ({ kind: "text", text: t });

/** One question as a WhatsApp message: reply buttons if the options fit, otherwise a list. */
export function questionMessages(q: Question, session: Session, position: number): Outbound[] {
  const total = session.question_ids.length;
  const options = q.options.map((o, i) => `${LETTERS[i]}) ${o}`);
  const header = `Question ${position + 1} of ${total} · ${SUBJECT_LABELS[q.subject]}`;
  const full = `${header}\n\n${q.stem}\n\n${options.join("\n")}`;
  const out: Outbound[] = [];
  let body = full;
  if (full.length > LIMITS.body) {
    out.push(text(full));
    body = `${header}\n\nChoose your answer.`;
  }
  const fitsButtons =
    options.length <= LIMITS.buttons && options.every((o) => o.length <= LIMITS.buttonTitle);
  if (fitsButtons) {
    out.push({
      kind: "buttons",
      text: body,
      buttons: options.map((o, i) => ({ id: replyIds.answer(session.id, position, i), title: o })),
    });
  } else {
    out.push({
      kind: "list",
      text: body,
      button: "Choose answer",
      rows: q.options.map((o, i) => ({
        id: replyIds.answer(session.id, position, i),
        title: truncate(`${LETTERS[i]}) ${o}`, LIMITS.rowTitle),
        ...(o.length > LIMITS.rowTitle - 3
          ? { description: truncate(o, LIMITS.rowDescription) }
          : {}),
      })),
    });
  }
  return out;
}

export function nextButton(session: Session) {
  const last = session.position >= session.question_ids.length - 1;
  return {
    id: replyIds.next(session.id, session.position),
    title: last ? "See my score ▶" : "Next question ▶",
  };
}

/** The marking: right or wrong, the explanation, then Next and "Explain another way". */
export function answerFeedback(
  q: Question,
  session: Session,
  correct: boolean,
  explanation: string,
): Outbound {
  const verdict = correct
    ? "✅ Correct!"
    : `❌ Not quite. The answer is ${LETTERS[q.answer_index]}) ${q.options[q.answer_index]}.`;
  return {
    kind: "buttons",
    text: truncate(`${verdict}\n\n${explanation}`, LIMITS.body),
    buttons: [
      nextButton(session),
      { id: replyIds.explainAgain(session.id, session.position), title: "Explain another way" },
    ],
  };
}
