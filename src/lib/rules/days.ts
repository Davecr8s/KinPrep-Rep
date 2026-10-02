// Student days run on Africa/Lagos time (CLAUDE.md). A "day" here is a Lagos calendar date as
// "YYYY-MM-DD". Lagos is UTC+1 all year (no daylight saving), which days.test.ts checks.

export type Day = string;

const LAGOS_OFFSET_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The Lagos calendar date of an instant. */
export function lagosDay(instant: Date): Day {
  return new Date(instant.getTime() + LAGOS_OFFSET_MS).toISOString().slice(0, 10);
}

/** The instant a Lagos day starts (Lagos midnight), as a UTC Date. */
export function lagosDayStart(day: Day): Date {
  return new Date(Date.parse(`${day}T00:00:00Z`) - LAGOS_OFFSET_MS);
}

export function addDays(day: Day, days: number): Day {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Monday of the week containing `day` (weeks run Monday to Sunday). */
export function weekStart(day: Day): Day {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(day, -((weekday + 6) % 7));
}

/** The seven days Monday..Sunday of the week starting `monday`. */
export function weekDays(monday: Day): Day[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** The Lagos year now, used by the 13-or-over rule. */
export function lagosYear(instant: Date): number {
  return Number(lagosDay(instant).slice(0, 4));
}
