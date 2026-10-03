import { DAILY_SET_MIX } from "@/config/pilot";
import { addDays, type Day } from "@/lib/rules/days";

// Pure rules for what one attempt changes: the topic's rolling accuracy and when a question
// comes back for spaced review.

export type Mastery = {
  attempts: number;
  correct: number;
  /** Weighted rolling accuracy, 0 to 1. */
  accuracy: number;
};

/**
 * A plain average for the first few attempts, then an exponential moving average in which the
 * newest answer weighs `weight` (20%): recent work counts more, so a topic stops looking weak
 * once the student has got the hang of it.
 */
export function updateMastery(
  previous: Mastery | null,
  correct: boolean,
  weight: number = DAILY_SET_MIX.masteryWeight,
): Mastery {
  const attempts = (previous?.attempts ?? 0) + 1;
  const alpha = Math.max(1 / attempts, weight);
  const accuracy = (previous?.accuracy ?? 0) * (1 - alpha) + (correct ? alpha : 0);
  return {
    attempts,
    correct: (previous?.correct ?? 0) + (correct ? 1 : 0),
    accuracy: Math.round(accuracy * 10_000) / 10_000,
  };
}

export type ReviewState = {
  /** Reviews answered correctly since the last wrong answer. */
  step: number;
  /** The Lagos day to ask again; null when there's nothing to review. */
  nextReviewDay: Day | null;
};

/**
 * Spaced review. A wrong answer brings the question back 1 day later; each right answer after
 * that pushes it out to the next interval (3 days, then 7); right at the 7-day review and it's
 * done. A wrong answer at any point starts again at 1 day.
 */
export function nextReview(
  previous: ReviewState | null,
  correct: boolean,
  day: Day,
  intervals: readonly number[] = DAILY_SET_MIX.reviewIntervalsDays,
): ReviewState | null {
  if (!correct) return { step: 0, nextReviewDay: addDays(day, intervals[0]!) };
  if (!previous || previous.nextReviewDay === null) return previous;
  const step = previous.step + 1;
  const interval = intervals[step];
  return { step, nextReviewDay: interval === undefined ? null : addDays(day, interval) };
}
