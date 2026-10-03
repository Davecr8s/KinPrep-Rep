import { z } from "zod";
import { SUBJECTS } from "@/config/pilot";
import { CLASSES } from "@/lib/labels";

// Pure rules for the question bank: what a valid question is, CSV in and out, and which approved
// questions look wrong from how students answer them. Unit tested in bank.test.ts.

export const LETTERS = ["A", "B", "C", "D", "E"] as const;

const text = (max: number, what: string) =>
  z.string().trim().min(1, `Enter ${what}.`).max(max, `Keep ${what} under ${max} characters.`);

/** A question as the editor and the CSV import submit it. */
export const QuestionInputSchema = z
  .object({
    topicId: z.uuid({ error: "Choose a topic." }),
    stem: z
      .string()
      .trim()
      .min(5, "Write the question.")
      .max(1000, "Keep the question under 1000 characters."),
    options: z
      .array(z.string().trim().max(200, "Keep each option under 200 characters."))
      .transform((options) => options.filter((o) => o.length > 0))
      .pipe(
        z.array(z.string()).min(2, "Give at least 2 options.").max(5, "Give at most 5 options."),
      ),
    answerIndex: z.coerce.number().int().min(0, "Choose the right answer."),
    explanationEn: text(1000, "the English explanation"),
    explanationPcm: z
      .string()
      .trim()
      .max(1000, "Keep the Pidgin explanation under 1000 characters.")
      .transform((v) => v || null),
    classes: z.array(z.enum(CLASSES)).min(1, "Choose at least one class."),
    syllabusRef: z
      .string()
      .trim()
      .max(200)
      .transform((v) => v || null),
    originalConfirmed: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.answerIndex >= v.options.length) {
      ctx.addIssue({ code: "custom", path: ["answerIndex"], message: "Choose the right answer." });
    }
    if (new Set(v.options.map((o) => o.toLowerCase())).size !== v.options.length) {
      ctx.addIssue({ code: "custom", path: ["options"], message: "Two options are the same." });
    }
  });
export type QuestionInput = z.output<typeof QuestionInputSchema>;

// ---- CSV (RFC 4180) ---------------------------------------------------------------------

/** Parses CSV text into rows of fields: quotes, doubled quotes, commas and new lines in fields. */
export function parseCsv(input: string): string[][] {
  const textIn = input.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < textIn.length; i++) {
    const c = textIn[i]!;
    if (quoted) {
      if (c === '"' && textIn[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && textIn[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

/**
 * One CSV field. Quoted when needed; a leading = + - @ is prefixed with ' so spreadsheet apps
 * don't run it as a formula (CSV injection). importRows strips that ' again.
 */
export function csvField(value: string | number | boolean | null | undefined): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export const CSV_COLUMNS = [
  "id",
  "subject",
  "topic",
  "stem",
  "option_a",
  "option_b",
  "option_c",
  "option_d",
  "option_e",
  "answer",
  "explanation_en",
  "explanation_pcm",
  "classes",
  "syllabus_ref",
  "original",
  "status",
  "source",
] as const;

export type CsvQuestion = {
  id: string;
  subject: string;
  topic: string;
  stem: string;
  options: string[];
  answerIndex: number;
  explanationEn: string;
  explanationPcm: string | null;
  classes: string[];
  syllabusRef: string | null;
  originalConfirmed: boolean;
  status: string;
  source: string;
};

export function toCsv(questions: readonly CsvQuestion[]): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (const q of questions) {
    const options = Array.from({ length: 5 }, (_, i) => q.options[i] ?? "");
    lines.push(
      [
        q.id,
        q.subject,
        q.topic,
        q.stem,
        ...options,
        LETTERS[q.answerIndex],
        q.explanationEn,
        q.explanationPcm,
        q.classes.join(";"),
        q.syllabusRef,
        q.originalConfirmed ? "yes" : "no",
        q.status,
        q.source,
      ]
        .map(csvField)
        .join(","),
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}

export type ImportRow = {
  line: number;
  subject: (typeof SUBJECTS)[number];
  topic: string;
  input: Omit<QuestionInput, "topicId">;
};
export type ImportError = { line: number; message: string };

const unformula = (s: string) => (/^'[=+\-@\t\r]/.test(s) ? s.slice(1) : s);

/**
 * Reads an import file (the export's columns; id, status and source are ignored: every imported
 * question starts as a draft for review). Returns the good rows and a reason for each bad one.
 */
export function importRows(csv: string): { rows: ImportRow[]; errors: ImportError[] } {
  const [header, ...data] = parseCsv(csv);
  const errors: ImportError[] = [];
  const rows: ImportRow[] = [];
  if (!header) return { rows, errors: [{ line: 1, message: "The file is empty." }] };
  const col = new Map(header.map((h, i) => [h.trim().toLowerCase(), i]));
  const missing = [
    "subject",
    "topic",
    "stem",
    "option_a",
    "option_b",
    "answer",
    "explanation_en",
  ].filter((c) => !col.has(c));
  if (missing.length) {
    return { rows, errors: [{ line: 1, message: `Missing columns: ${missing.join(", ")}.` }] };
  }
  data.forEach((fields, i) => {
    const line = i + 2;
    const get = (name: string) => unformula((fields[col.get(name) ?? -1] ?? "").trim());
    const subject = get("subject").toLowerCase();
    if (!(SUBJECTS as readonly string[]).includes(subject)) {
      errors.push({ line, message: `Unknown subject "${get("subject")}".` });
      return;
    }
    const letter = get("answer").toUpperCase();
    const parsed = QuestionInputSchema.safeParse({
      topicId: "00000000-0000-4000-8000-000000000000", // checked against the topics later
      stem: get("stem"),
      options: ["option_a", "option_b", "option_c", "option_d", "option_e"].map(get),
      answerIndex: LETTERS.indexOf(letter as (typeof LETTERS)[number]),
      explanationEn: get("explanation_en"),
      explanationPcm: get("explanation_pcm"),
      classes: get("classes")
        ? get("classes")
            .toUpperCase()
            .split(/[;\s]+/)
            .filter(Boolean)
        : [...CLASSES],
      syllabusRef: get("syllabus_ref"),
      originalConfirmed: /^(yes|y|true|1)$/i.test(get("original")),
    });
    if (!parsed.success) {
      errors.push({ line, message: parsed.error.issues.map((e) => e.message).join(" ") });
      return;
    }
    const { topicId, ...input } = parsed.data;
    void topicId; // placeholder; the real topic is looked up by name
    rows.push({ line, subject: subject as ImportRow["subject"], topic: get("topic"), input });
  });
  return { rows, errors };
}

// ---- Re-check flags ----------------------------------------------------------------------

export type QuestionStats = {
  id: string;
  topicId: string;
  attempts: number;
  correct: number;
  /** How many chose each option. */
  chosen: number[];
  answerIndex: number;
};

export type LowCorrectRate = {
  id: string;
  attempts: number;
  /** Correct rate, 0-100. */
  rate: number;
  /** The rest of the topic's correct rate, 0-100, if it has other answered questions. */
  topicRate: number | null;
  /** The wrong option chosen most, when it's more popular than the right one: a wrong key? */
  popularWrong: { index: number; share: number } | null;
};

/**
 * Approved questions students get wrong unusually often: at least `minAttempts` answers, a
 * correct rate under 30%, and well below (20+ points) the rest of their topic. Often a wrong
 * answer key or a confusing stem, so they're worth a reviewer's second look.
 */
export function lowCorrectRates(
  stats: readonly QuestionStats[],
  {
    minAttempts = 10,
    maxRate = 30,
    gap = 20,
  }: { minAttempts?: number; maxRate?: number; gap?: number } = {},
): LowCorrectRate[] {
  const out: LowCorrectRate[] = [];
  for (const q of stats) {
    if (q.attempts < minAttempts) continue;
    const rate = Math.round((q.correct / q.attempts) * 100);
    if (rate >= maxRate) continue;
    const others = stats.filter((o) => o.topicId === q.topicId && o.id !== q.id && o.attempts > 0);
    const otherAttempts = others.reduce((n, o) => n + o.attempts, 0);
    const topicRate =
      otherAttempts > 0
        ? Math.round((others.reduce((n, o) => n + o.correct, 0) / otherAttempts) * 100)
        : null;
    if (topicRate !== null && topicRate - rate < gap) continue;
    let popular: { index: number; share: number } | null = null;
    q.chosen.forEach((n, index) => {
      if (
        index !== q.answerIndex &&
        n > (q.chosen[q.answerIndex] ?? 0) &&
        n > (popular ? q.chosen[popular.index]! : 0)
      ) {
        popular = { index, share: Math.round((n / q.attempts) * 100) };
      }
    });
    out.push({ id: q.id, attempts: q.attempts, rate, topicRate, popularWrong: popular });
  }
  return out.sort((a, b) => a.rate - b.rate);
}
