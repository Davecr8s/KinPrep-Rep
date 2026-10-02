// Pilot defaults and limits. The live questions-per-day value is an admin setting stored
// in the database; these are its default and hard cap.

export const SUBJECTS = ["english", "mathematics", "physics", "biology"] as const;
export type Subject = (typeof SUBJECTS)[number];

export const STUDENT_TIMEZONE = "Africa/Lagos";

export const QUESTIONS_PER_DAY = { default: 10, max: 20 } as const;

// A Lagos day counts towards the streak once this many questions are answered.
export const STREAK_DAY_THRESHOLD = 5;

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
