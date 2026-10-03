// Pilot defaults and limits. The live questions-per-day value is an admin setting stored
// in the database; these are its default and hard cap.

export const SUBJECTS = ["english", "mathematics", "physics", "biology"] as const;
export type Subject = (typeof SUBJECTS)[number];

export const STUDENT_TIMEZONE = "Africa/Lagos";

export const QUESTIONS_PER_DAY = { default: 10, max: 20 } as const;

// A Lagos day counts towards the streak once this many questions are answered. Default for the
// admin setting "streak_day_threshold".
export const STREAK_DAY_THRESHOLD = 5;

// How the daily set is chosen (src/lib/engine).
export const DAILY_SET_MIX = {
  /** About 60% from the student's weakest topics, 20% spaced review, 20% topics not yet seen. */
  weak: 0.6,
  review: 0.2,
  newTopics: 0.2,
  /** A topic counts as "weak" only once it has this many attempts. */
  weakMinAttempts: 5,
  /** How many of the weakest topics the weak share is spread over. */
  weakTopics: 3,
  /** Re-ask a wrongly answered question after 1 day, then 3, then 7 (each after the last ask). */
  reviewIntervalsDays: [1, 3, 7],
  /** A question answered correctly isn't asked again for this many days, unless the bank runs out. */
  noRepeatDays: 30,
  /** Weight of the newest answer in a topic's rolling accuracy, once it has enough attempts. */
  masteryWeight: 0.2,
} as const;

export const PILOT_TARGETS = { sponsorsAbroad: 10, parentsNigeria: 20 } as const;

export type GoStopMeasure = {
  key: string;
  label: string;
  unit: "count" | "percent";
  go: number;
  /** Out of how many approached; shown as "go 10 of 50". */
  outOf?: number;
  /** Below this value the pilot should stop. Omitted when the brief sets no stop line. */
  stopBelow?: number;
};

export const GO_STOP_MEASURES = [
  {
    key: "sponsors_paying",
    label: "Sponsors abroad paying",
    unit: "count",
    go: 10,
    outOf: 50,
    stopBelow: 3,
  },
  {
    key: "parents_paying",
    label: "Parents paying",
    unit: "count",
    go: 20,
    outOf: 50,
    stopBelow: 5,
  },
  {
    key: "students_5_days",
    label: "Students practising 5+ days a week",
    unit: "percent",
    go: 70,
    stopBelow: 40,
  },
  {
    key: "renewals_after_week_4",
    label: "Renewals after week 4",
    unit: "percent",
    go: 50,
    stopBelow: 25,
  },
  { key: "bulk_enquiries", label: "Bulk enquiries", unit: "count", go: 2 },
  {
    key: "ambassador_payers",
    label: "Ambassador-referred payers",
    unit: "count",
    go: 5,
  },
] as const satisfies readonly GoStopMeasure[];
