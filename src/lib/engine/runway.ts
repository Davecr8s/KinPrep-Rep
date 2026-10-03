import { DAILY_SET_MIX, SUBJECTS } from "@/config/pilot";

// How long a subject's question bank lasts. Pure; src/lib/engine/index.ts gathers the counts.

export type RunwayStudent = {
  /** Approved questions in the subject (for their class) the student has never answered. */
  fresh: number;
  /** How many subjects the student takes; the day's set is spread across them. */
  subjects: number;
};

/**
 * Days of fresh questions left for an average active student at the current questions-per-day
 * setting. About 80% of a set is fresh (the rest is spaced review), spread evenly over the
 * student's subjects. With no active students, a new student taking every subject is assumed.
 */
export function runwayDays(input: {
  students: readonly RunwayStudent[];
  bankSize: number;
  questionsPerDay: number;
}): number {
  const people: readonly RunwayStudent[] =
    input.students.length > 0
      ? input.students
      : [{ fresh: input.bankSize, subjects: SUBJECTS.length }];
  const freshShare = 1 - DAILY_SET_MIX.review;
  const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;
  const fresh = mean(people.map((p) => p.fresh));
  const perDay = mean(
    people.map((p) => (input.questionsPerDay * freshShare) / Math.max(1, p.subjects)),
  );
  return perDay > 0 ? Math.floor(fresh / perDay) : 0;
}
