"use client";

import { useActionState, useMemo, useState } from "react";
import type { Subject } from "@/config/pilot";
import { Notice, styles } from "@/components/ui";
import { CLASSES, SUBJECT_LABELS } from "@/lib/labels";
import type { Question, Session } from "@/lib/practice/repo";
import { feedbackScreen, questionScreen } from "@/lib/practice/web-html";
import type { Outbound } from "@/lib/whatsapp/messages";
import { answerFeedback, questionMessages } from "@/lib/whatsapp/question-format";
import type { EditorState } from "./actions";

// The question editor with a live preview of exactly what students see: the WhatsApp messages
// the bot sends (same code as the bot) and the web practice page (same HTML as /p/<token>).

export type EditorTopic = { id: string; subject: Subject; name: string };
export type EditorQuestion = {
  topicId: string;
  stem: string;
  options: string[];
  answerIndex: number;
  explanationEn: string;
  explanationPcm: string;
  classes: string[];
  syllabusRef: string;
  originalConfirmed: boolean;
  source: "human" | "ai_draft" | "import";
  status: string;
};

const LETTERS = ["A", "B", "C", "D", "E"];
const PREVIEW_SESSION: Session = {
  id: "00000000-0000-4000-8000-000000000000",
  question_ids: Array.from({ length: 10 }, (_, i) => `q${i}`),
  position: 2,
  awaiting: "answer",
  completed_at: null,
};

function WhatsAppBubble({ message }: { message: Outbound }) {
  if (message.kind === "template") return null;
  return (
    <div className="flex flex-col gap-1">
      <div className="max-w-[85%] rounded-lg rounded-tl-none bg-white px-3 py-2 text-sm whitespace-pre-wrap text-gray-900 shadow-sm">
        {message.text}
      </div>
      {message.kind === "buttons" &&
        message.buttons.map((b) => (
          <div
            key={b.id}
            className="max-w-[85%] rounded-lg bg-white px-3 py-2 text-center text-sm font-semibold text-sky-700 shadow-sm"
          >
            {b.title}
          </div>
        ))}
      {message.kind === "list" && (
        <>
          <div className="max-w-[85%] rounded-lg bg-white px-3 py-2 text-center text-sm font-semibold text-sky-700 shadow-sm">
            ☰ {message.button}
          </div>
          <ul className="max-w-[85%] rounded-lg bg-white text-sm shadow-sm">
            {message.rows.map((r) => (
              <li key={r.id} className="border-b border-gray-100 px-3 py-2 last:border-0">
                <span className="font-medium">{r.title}</span>
                {r.description && (
                  <span className="block text-xs text-gray-500">{r.description}</span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export function QuestionEditor({
  topics,
  initial,
  action,
}: {
  topics: EditorTopic[];
  initial: EditorQuestion | null;
  action: (state: EditorState, formData: FormData) => Promise<EditorState>;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [topicId, setTopicId] = useState(initial?.topicId ?? topics[0]?.id ?? "");
  const [stem, setStem] = useState(initial?.stem ?? "");
  const [options, setOptions] = useState<string[]>(
    Array.from({ length: 5 }, (_, i) => initial?.options[i] ?? ""),
  );
  const [answer, setAnswer] = useState(initial?.answerIndex ?? 0);
  const [explanationEn, setExplanationEn] = useState(initial?.explanationEn ?? "");
  const [explanationPcm, setExplanationPcm] = useState(initial?.explanationPcm ?? "");
  const [language, setLanguage] = useState<"en" | "pcm">("en");
  const [step, setStep] = useState<"question" | "answered">("question");
  const aiDraft = initial?.source === "ai_draft";

  const topic = topics.find((t) => t.id === topicId);
  const preview = useMemo((): Question | null => {
    const filled = options.map((o) => o.trim()).filter(Boolean);
    if (!topic || !stem.trim() || filled.length < 2 || !options[answer]?.trim()) return null;
    return {
      id: "preview",
      stem: stem.trim(),
      options: filled,
      answer_index: options.slice(0, answer).filter((o) => o.trim()).length,
      explanation_en: explanationEn.trim() || "(English explanation)",
      explanation_pcm: explanationPcm.trim() || null,
      subject: topic.subject,
      topic: topic.name,
    };
  }, [topic, stem, options, answer, explanationEn, explanationPcm]);

  const explanation =
    preview &&
    (language === "pcm"
      ? (preview.explanation_pcm ?? preview.explanation_en)
      : preview.explanation_en);
  const whatsapp = preview
    ? step === "question"
      ? questionMessages(preview, PREVIEW_SESSION, 2)
      : [answerFeedback(preview, PREVIEW_SESSION, true, explanation!)]
    : [];
  const web = preview
    ? step === "question"
      ? questionScreen({ firstName: "Ada", question: preview, position: 2, total: 10 })
      : feedbackScreen({
          firstName: "Ada",
          question: preview,
          position: 2,
          total: 10,
          chosen: preview.answer_index,
          correct: true,
          explanation: explanation!,
        })
    : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <form action={formAction} className="flex flex-col gap-4">
        {state.error && <Notice tone="warn">{state.error}</Notice>}
        {aiDraft && (
          <Notice>
            AI draft: check the answer and the explanation carefully before approving. It is never
            sent to students until approved.
          </Notice>
        )}
        <label className="flex flex-col gap-1">
          <span className={styles.label}>Topic</span>
          <select
            name="topicId"
            value={topicId}
            onChange={(e) => setTopicId(e.target.value)}
            className={styles.input}
          >
            {topics.map((t) => (
              <option key={t.id} value={t.id}>
                {SUBJECT_LABELS[t.subject]}: {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={styles.label}>Question</span>
          <textarea
            name="stem"
            value={stem}
            onChange={(e) => setStem(e.target.value)}
            rows={3}
            maxLength={1000}
            className={styles.input}
          />
        </label>
        <fieldset className="flex flex-col gap-2">
          <legend className={styles.label}>Options (tick the right answer)</legend>
          {options.map((o, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="radio"
                name="answerIndex"
                value={i}
                checked={answer === i}
                onChange={() => setAnswer(i)}
                aria-label={`${LETTERS[i]} is the right answer`}
                className="size-5 accent-navy"
              />
              <span className="w-5 font-bold text-navy">{LETTERS[i]}</span>
              <input
                name="option"
                value={o}
                maxLength={200}
                onChange={(e) =>
                  setOptions((list) => list.map((v, j) => (j === i ? e.target.value : v)))
                }
                placeholder={i < 2 ? "Required" : "Optional"}
                className={styles.input}
              />
            </div>
          ))}
        </fieldset>
        <label className="flex flex-col gap-1">
          <span className={styles.label}>Explanation (English)</span>
          <textarea
            name="explanationEn"
            value={explanationEn}
            onChange={(e) => setExplanationEn(e.target.value)}
            rows={3}
            maxLength={1000}
            className={styles.input}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={styles.label}>Explanation (Pidgin)</span>
          <textarea
            name="explanationPcm"
            value={explanationPcm}
            onChange={(e) => setExplanationPcm(e.target.value)}
            rows={3}
            maxLength={1000}
            className={styles.input}
          />
        </label>
        <fieldset className="flex flex-wrap gap-3">
          <legend className={styles.label}>Classes</legend>
          {CLASSES.map((c) => (
            <label key={c} className="flex items-center gap-1">
              <input
                type="checkbox"
                name="classes"
                value={c}
                defaultChecked={
                  initial ? initial.classes.includes(c) : c.startsWith("SS") || c === "UTME"
                }
                className="size-4 accent-navy"
              />
              {c}
            </label>
          ))}
        </fieldset>
        <label className="flex flex-col gap-1">
          <span className={styles.label}>Syllabus reference (optional)</span>
          <input
            name="syllabusRef"
            defaultValue={initial?.syllabusRef ?? ""}
            maxLength={200}
            className={styles.input}
          />
        </label>
        <div className="flex flex-col gap-2 rounded-lg bg-navy/5 p-3">
          <label className="flex gap-3">
            <input
              type="checkbox"
              name="originalConfirmed"
              defaultChecked={initial?.originalConfirmed ?? false}
              className="mt-1 size-5 shrink-0 accent-navy"
            />
            <span>Original question, not from a past paper</span>
          </label>
          {aiDraft && (
            <>
              <label className="flex gap-3">
                <input
                  type="checkbox"
                  name="answerChecked"
                  className="mt-1 size-5 shrink-0 accent-navy"
                />
                <span>I have checked the answer is right</span>
              </label>
              <label className="flex gap-3">
                <input
                  type="checkbox"
                  name="explanationChecked"
                  className="mt-1 size-5 shrink-0 accent-navy"
                />
                <span>I have checked both explanations</span>
              </label>
            </>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button name="mode" value="approve" disabled={pending} className={styles.primaryButton}>
            Save and approve
          </button>
          <button name="mode" value="review" disabled={pending} className={styles.secondaryButton}>
            Send for review
          </button>
          <button name="mode" value="draft" disabled={pending} className={styles.secondaryButton}>
            Save draft
          </button>
        </div>
      </form>

      <section aria-label="Preview" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold text-navy-dark">Preview:</span>
          {(["question", "answered"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStep(s)}
              aria-pressed={step === s}
              className={`rounded-full border px-3 py-1 ${step === s ? "border-navy bg-navy text-white" : "border-navy/30"}`}
            >
              {s === "question" ? "Question" : "After answering"}
            </button>
          ))}
          {(["en", "pcm"] as const).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLanguage(l)}
              aria-pressed={language === l}
              className={`rounded-full border px-3 py-1 ${language === l ? "border-navy bg-navy text-white" : "border-navy/30"}`}
            >
              {l === "en" ? "English" : "Pidgin"}
            </button>
          ))}
        </div>
        {!preview ? (
          <p className={styles.hint}>
            Write the question, at least two options and tick the right one to see the preview.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="mb-1 text-sm font-semibold text-navy-dark">WhatsApp</p>
              <div className="flex min-h-64 flex-col gap-2 rounded-xl bg-[#e5ddd5] p-3">
                {whatsapp.map((m, i) => (
                  <WhatsAppBubble key={i} message={m} />
                ))}
              </div>
            </div>
            <div>
              <p className="mb-1 text-sm font-semibold text-navy-dark">Web page</p>
              <iframe
                title="Web practice page preview"
                srcDoc={web ?? ""}
                sandbox=""
                className="h-[560px] w-full rounded-xl border border-navy/20 bg-white"
              />
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
