// Every WhatsApp message template KinPrep sends, in one place: the name and language Meta knows
// it by, the category we submit it under, its body with {{1}}... variables, and its buttons.
// Submit each one in Meta's WhatsApp Manager exactly as written here ({APP_URL} is the site's
// address, e.g. https://kinprep.ng). `node scripts/meta-templates.ts` compares this file with
// what Meta approved, and flags any template Meta moved to "marketing".
//
// No imports: scripts read this file directly with Node.

export type TemplateCategory = "utility" | "marketing" | "authentication";

export type TemplateButton =
  | { type: "quick_reply"; text: string; payload: string }
  /** A link button; `{{1}}` at the end of `url` is filled per message with `variable`. */
  | { type: "url"; text: string; url: string; variable: string };

export type TemplateDefinition = {
  name: string;
  language: string;
  category: TemplateCategory;
  /** When it's sent and to whom. */
  purpose: string;
  body: string;
  /** What fills {{1}}, {{2}}, ... in the body, in order. */
  variables: readonly string[];
  buttons?: readonly TemplateButton[];
};

export const TEMPLATES = {
  morningPractice: {
    name: "kinprep_morning_practice",
    language: "en",
    category: "utility",
    purpose: "07:00 Lagos, to opted-in seniors with an active plan (one per household number)",
    body: "Good morning {{1}}! Your KinPrep practice for today is ready. Tap Start when you are ready to begin.",
    variables: ["first_names"],
    buttons: [{ type: "quick_reply", text: "Start", payload: "START" }],
  },
  juniorPracticeLink: {
    name: "kinprep_junior_practice_link",
    language: "en",
    category: "utility",
    purpose: "07:00 Lagos, to the parent of each active junior (never to the child)",
    body: "Good morning! Today's KinPrep practice for {{1}} is ready. Open it on your phone and hand it over. The link works for 24 hours.",
    variables: ["child_first_name"],
    buttons: [
      {
        type: "url",
        text: "Open practice",
        url: "{APP_URL}/p/{{1}}",
        variable: "practice_token",
      },
    ],
  },
  practiceReminder: {
    name: "kinprep_practice_reminder",
    language: "en",
    category: "utility",
    purpose:
      "18:00 Lagos, to opted-in seniors who haven't started today; only when reminder_enabled is on",
    body: "Hi {{1}}, today's KinPrep questions are still waiting for you. A few minutes now keeps your streak going.",
    variables: ["first_names"],
    buttons: [{ type: "quick_reply", text: "Start", payload: "START" }],
  },
  missedDays: {
    name: "kinprep_missed_days",
    language: "en",
    category: "utility",
    purpose: "21:00 Lagos, once to each payer when a student has missed 2 days in a row",
    body: "KinPrep update: {{1}} has not practised for {{2}} days in a row. A short message from you can help them get back on track.",
    variables: ["child_first_name", "days"],
    buttons: [
      {
        type: "url",
        text: "See progress",
        url: "{APP_URL}/app/children/{{1}}",
        variable: "student_id",
      },
    ],
  },
  weeklyReport: {
    name: "kinprep_weekly_report",
    language: "en",
    category: "utility",
    purpose:
      "Saturday evening to Sunday, at each payer's chosen hour in their timezone (WhatsApp opt-in only)",
    body: "Weekly KinPrep report for {{1}}: practised on {{2}} of 7 days. Average score: {{3}} ({{4}}). Topic to work on: {{5}}. {{6}} Tap below for the full report.",
    variables: [
      "child_first_name",
      "days_practised",
      "average_score",
      "trend",
      "weakest_topic",
      "encouraging_line",
    ],
    buttons: [
      {
        type: "url",
        text: "Full report",
        url: "{APP_URL}/app/children/{{1}}/report",
        variable: "student_id",
      },
    ],
  },
} as const satisfies Record<string, TemplateDefinition>;

export type TemplateKey = keyof typeof TEMPLATES;

/** The body with its variables filled in: what the recipient reads. */
export function renderTemplate(key: TemplateKey, values: readonly string[]): string {
  const t: TemplateDefinition = TEMPLATES[key];
  if (values.length !== t.variables.length) {
    throw new Error(`${t.name} needs ${t.variables.length} values, got ${values.length}`);
  }
  return t.body.replace(/\{\{(\d+)\}\}/g, (_, n: string) => values[Number(n) - 1]!);
}
