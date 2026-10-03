import { META_PRICE_USD, REPORT_TIMES, type MessageCategory } from "@/config/messaging";
import { addDays, type Day } from "@/lib/rules/days";
import { weeklyReport, type AnswerRow } from "@/lib/rules/progress";

// Pure rules for the scheduled jobs: what a message costs, when a payer's weekly report is due,
// and what the report says. Unit tested in jobs.test.ts.

const CALLING_CODES = ["234", "353", "44", "1"]; // longest prefixes first where they overlap

/**
 * Estimated cost of one send in US dollars. Email is free to us; a utility template sent while
 * the person's 24-hour window is open is free; otherwise Meta's per-message price for the
 * recipient's country (src/config/messaging.ts).
 */
export function estimateCostUsd(input: {
  channel: "whatsapp" | "email";
  recipient: string;
  category: string;
  windowOpen: boolean;
}): number {
  if (input.channel === "email") return 0;
  if (input.category === "utility" && input.windowOpen) return 0;
  const digits = input.recipient.replace(/^\+/, "");
  const code = CALLING_CODES.find((c) => digits.startsWith(c)) ?? "other";
  const prices = META_PRICE_USD[code]!;
  return prices[input.category as MessageCategory] ?? prices.marketing;
}

/** "Ada", "Ada and Chidi", "Ada, Chidi and Emeka". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

function localParts(timeZone: string, at: Date): { weekday: number; hour: number; date: Day } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return {
    weekday,
    hour: Number(get("hour")),
    date: `${get("year")}-${get("month")}-${get("day")}`,
  };
}

/** Hours since Saturday 18:00 in the report window, or null outside it. */
function windowPosition(weekday: number, hour: number): number | null {
  const { saturday, sunday } = REPORT_TIMES;
  if (weekday === saturday.weekday && hour >= saturday.fromHour) return hour - saturday.fromHour;
  if (weekday === sunday.weekday) return 24 - saturday.fromHour + hour;
  return null;
}

/** Is the payer's chosen report time (Saturday evening to Sunday) a valid one? */
export function isReportTime(weekday: number, hour: number): boolean {
  const { saturday, sunday } = REPORT_TIMES;
  return (
    (weekday === saturday.weekday && hour >= saturday.fromHour && hour <= saturday.toHour) ||
    (weekday === sunday.weekday && hour >= sunday.fromHour && hour <= sunday.toHour)
  );
}

/**
 * Is this payer's weekly report due now? Due from their chosen hour (in their own timezone) until
 * the end of Sunday there, so a late or missed run still sends it; the job's dedupe key stops a
 * second send. `weekStart` is the Monday of the week being reported.
 */
export function reportDue(
  payer: { timezone: string; weekday: number; hour: number },
  now: Date,
): { due: boolean; weekStart: Day } {
  const local = localParts(payer.timezone, now);
  const weekStart = addDays(local.date, local.weekday === 0 ? -6 : 1 - local.weekday);
  const position = windowPosition(local.weekday, local.hour);
  const chosen = windowPosition(payer.weekday, payer.hour);
  return { due: position !== null && chosen !== null && position >= chosen, weekStart };
}

export type WeeklySummary = {
  daysPractised: number;
  /** Average score (accuracy) this week, 0-100, or null with no answers. */
  averageScore: number | null;
  /** Change in average score on last week, in points, or null if either week has no score. */
  trendPoints: number | null;
  weakestTopic: string | null;
  line: string;
};

/** One encouraging line, chosen by how the week went. */
export function encouragingLine(
  firstName: string,
  s: Omit<WeeklySummary, "line" | "weakestTopic">,
): string {
  if (s.averageScore === null) {
    return `A fresh week starts on Monday: a few questions a day makes a real difference for ${firstName}.`;
  }
  if (s.trendPoints !== null && s.trendPoints >= 5) {
    return `Scores are climbing. Tell ${firstName} you noticed!`;
  }
  if (s.daysPractised >= 5) {
    return `${firstName} practised on most days. That habit is what moves grades.`;
  }
  if (s.trendPoints !== null && s.trendPoints <= -5) {
    return `A dip is normal. A word of encouragement will help ${firstName} keep going.`;
  }
  return `Every question counts. A quick message from you keeps ${firstName} going.`;
}

/** The week that starts on `monday` (Lagos days), compared with the week before. */
export function weeklySummary(
  answers: readonly AnswerRow[],
  monday: Day,
  firstName: string,
  threshold?: number,
): WeeklySummary {
  const thisWeek = weeklyReport(answers, monday, threshold);
  const lastWeek = weeklyReport(answers, addDays(monday, -7), threshold);
  const trendPoints =
    thisWeek.accuracy === null || lastWeek.accuracy === null
      ? null
      : thisWeek.accuracy - lastWeek.accuracy;
  const base = {
    daysPractised: thisWeek.daysPractised,
    averageScore: thisWeek.accuracy,
    trendPoints,
  };
  return {
    ...base,
    weakestTopic: thisWeek.weakestTopics[0]?.topic ?? null,
    line: encouragingLine(firstName, base),
  };
}

/** The weekly report template's six values, in order. */
export function weeklyReportValues(firstName: string, s: WeeklySummary): string[] {
  const trend =
    s.averageScore === null
      ? "no questions answered this week"
      : s.trendPoints === null
        ? "no score last week to compare"
        : s.trendPoints > 0
          ? `up ${s.trendPoints} points on last week`
          : s.trendPoints < 0
            ? `down ${-s.trendPoints} points on last week`
            : "the same as last week";
  return [
    firstName,
    String(s.daysPractised),
    s.averageScore === null ? "none yet" : `${s.averageScore}%`,
    trend,
    s.weakestTopic ?? "none yet",
    s.line,
  ];
}

/**
 * Consecutive Lagos days with no answers, ending today, never counting days before the student
 * was added. `practisedDays` are the Lagos days with at least one answer.
 */
export function missedDaysInARow(
  practisedDays: ReadonlySet<Day>,
  today: Day,
  firstDay: Day,
): { days: number; since: Day | null } {
  let days = 0;
  let day = today;
  while (day >= firstDay && !practisedDays.has(day)) {
    days += 1;
    day = addDays(day, -1);
  }
  return { days, since: days > 0 ? addDays(today, 1 - days) : null };
}
