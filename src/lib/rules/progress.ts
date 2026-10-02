import { STREAK_DAY_THRESHOLD, type Subject } from "@/config/pilot";
import { addDays, lagosDay, weekDays, weekStart, type Day } from "./days";

// Progress figures for the payer dashboard and the weekly report. Everything is derived from the
// student's answers; a day "counts" (dot filled, streak kept) at STREAK_DAY_THRESHOLD answers.

export type AnswerRow = {
  answeredAt: Date;
  correct: boolean;
  subject: Subject;
  topic: string;
  sessionId: string;
};

type Tally = { answered: number; correct: number };

function tallyByDay(answers: readonly AnswerRow[]): Map<Day, Tally> {
  const days = new Map<Day, Tally>();
  for (const a of answers) {
    const day = lagosDay(a.answeredAt);
    const t = days.get(day) ?? { answered: 0, correct: 0 };
    t.answered += 1;
    if (a.correct) t.correct += 1;
    days.set(day, t);
  }
  return days;
}

function accuracy(t: Tally): number | null {
  return t.answered === 0 ? null : Math.round((t.correct / t.answered) * 100);
}

export type WeekDot = { day: Day; practised: boolean; today: boolean; future: boolean };

/** This week's seven dots, Monday to Sunday. */
export function weekDots(answers: readonly AnswerRow[], today: Day): WeekDot[] {
  const byDay = tallyByDay(answers);
  return weekDays(weekStart(today)).map((day) => ({
    day,
    practised: (byDay.get(day)?.answered ?? 0) >= STREAK_DAY_THRESHOLD,
    today: day === today,
    future: day > today,
  }));
}

/**
 * Consecutive practice days up to today. Today not yet done doesn't break the streak (the student
 * still has until Lagos midnight), so counting starts from yesterday in that case.
 */
export function currentStreak(answers: readonly AnswerRow[], today: Day): number {
  const byDay = tallyByDay(answers);
  const counts = (day: Day) => (byDay.get(day)?.answered ?? 0) >= STREAK_DAY_THRESHOLD;
  let day = counts(today) ? today : addDays(today, -1);
  let streak = 0;
  while (counts(day)) {
    streak += 1;
    day = addDays(day, -1);
  }
  return streak;
}

export type WeekAccuracy = { weekStart: Day; answered: number; accuracy: number | null };

/** Accuracy per week for the last `weeks` weeks, oldest first, this week last. */
export function weeklyAccuracy(
  answers: readonly AnswerRow[],
  today: Day,
  weeks = 8,
): WeekAccuracy[] {
  const thisWeek = weekStart(today);
  const series = Array.from({ length: weeks }, (_, i) => addDays(thisWeek, -7 * (weeks - 1 - i)));
  const byWeek = new Map<Day, Tally>(series.map((w) => [w, { answered: 0, correct: 0 }]));
  for (const a of answers) {
    const t = byWeek.get(weekStart(lagosDay(a.answeredAt)));
    if (!t) continue;
    t.answered += 1;
    if (a.correct) t.correct += 1;
  }
  return series.map((w) => {
    const t = byWeek.get(w)!;
    return { weekStart: w, answered: t.answered, accuracy: accuracy(t) };
  });
}

export type TopicAccuracy = { subject: Subject; topic: string; attempts: number; accuracy: number };

/** The weakest topics with enough attempts to judge: lowest accuracy, then most attempts. */
export function weakestTopics(
  answers: readonly AnswerRow[],
  { minAttempts = 3, limit = 3 }: { minAttempts?: number; limit?: number } = {},
): TopicAccuracy[] {
  const byTopic = new Map<string, { subject: Subject; topic: string } & Tally>();
  for (const a of answers) {
    const key = `${a.subject}\u0000${a.topic}`;
    const t = byTopic.get(key) ?? { subject: a.subject, topic: a.topic, answered: 0, correct: 0 };
    t.answered += 1;
    if (a.correct) t.correct += 1;
    byTopic.set(key, t);
  }
  return [...byTopic.values()]
    .filter((t) => t.answered >= minAttempts)
    .map((t) => ({
      subject: t.subject,
      topic: t.topic,
      attempts: t.answered,
      accuracy: accuracy(t)!,
    }))
    .sort(
      (a, b) =>
        a.accuracy - b.accuracy || b.attempts - a.attempts || a.topic.localeCompare(b.topic),
    )
    .slice(0, limit);
}

export type SessionSummary = {
  sessionId: string;
  startedAt: Date;
  day: Day;
  answered: number;
  correct: number;
  subjects: Subject[];
};

/** The most recent sessions, newest first. */
export function recentSessions(answers: readonly AnswerRow[], limit = 10): SessionSummary[] {
  const sessions = new Map<string, SessionSummary>();
  for (const a of answers) {
    const s = sessions.get(a.sessionId) ?? {
      sessionId: a.sessionId,
      startedAt: a.answeredAt,
      day: lagosDay(a.answeredAt),
      answered: 0,
      correct: 0,
      subjects: [],
    };
    if (a.answeredAt < s.startedAt) {
      s.startedAt = a.answeredAt;
      s.day = lagosDay(a.answeredAt);
    }
    s.answered += 1;
    if (a.correct) s.correct += 1;
    if (!s.subjects.includes(a.subject)) s.subjects.push(a.subject);
    sessions.set(a.sessionId, s);
  }
  return [...sessions.values()]
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
    .slice(0, limit);
}

export type WeeklyReport = {
  weekStart: Day;
  weekEnd: Day;
  daysPractised: number;
  answered: number;
  accuracy: number | null;
  bySubject: { subject: Subject; answered: number; accuracy: number | null }[];
  streak: number;
  weakestTopics: TopicAccuracy[];
};

/**
 * The Monday-to-Sunday report (Lagos days). `answers` should reach back far enough for the
 * streak; only the week's answers count towards the other figures.
 */
export function weeklyReport(answers: readonly AnswerRow[], monday: Day): WeeklyReport {
  const sunday = addDays(monday, 6);
  const inWeek = answers.filter((a) => {
    const day = lagosDay(a.answeredAt);
    return day >= monday && day <= sunday;
  });
  const total: Tally = { answered: 0, correct: 0 };
  const bySubject = new Map<Subject, Tally>();
  for (const a of inWeek) {
    total.answered += 1;
    if (a.correct) total.correct += 1;
    const t = bySubject.get(a.subject) ?? { answered: 0, correct: 0 };
    t.answered += 1;
    if (a.correct) t.correct += 1;
    bySubject.set(a.subject, t);
  }
  const upToSunday = answers.filter((a) => lagosDay(a.answeredAt) <= sunday);
  return {
    weekStart: monday,
    weekEnd: sunday,
    daysPractised: weekDots(inWeek, sunday).filter((d) => d.practised).length,
    answered: total.answered,
    accuracy: accuracy(total),
    bySubject: [...bySubject.entries()]
      .map(([subject, t]) => ({ subject, answered: t.answered, accuracy: accuracy(t) }))
      .sort((a, b) => b.answered - a.answered),
    streak: currentStreak(upToSunday, sunday),
    weakestTopics: weakestTopics(inWeek, { minAttempts: 2 }),
  };
}

const SUBJECT_NAMES: Record<Subject, string> = {
  english: "English",
  mathematics: "Mathematics",
  physics: "Physics",
  biology: "Biology",
};

export function subjectName(subject: Subject): string {
  return SUBJECT_NAMES[subject];
}

function shortDate(day: Day): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/** One plain-English line about the week, used in both the page and the WhatsApp report. */
export function reportHeadline(report: WeeklyReport, firstName: string): string {
  if (report.daysPractised >= 5)
    return `Brilliant week: ${firstName} practised ${report.daysPractised} of 7 days.`;
  if (report.daysPractised >= 3)
    return `Good effort: ${firstName} practised ${report.daysPractised} of 7 days.`;
  if (report.daysPractised >= 1) {
    return `${firstName} practised ${report.daysPractised} of 7 days. A word of encouragement could help.`;
  }
  return `${firstName} didn't practise this week. A message from you could get them started again.`;
}

/** The WhatsApp weekly report text: the same content as the report page. */
export function reportText(report: WeeklyReport, firstName: string): string {
  const lines = [
    `KinPrep weekly report for ${firstName}`,
    `${shortDate(report.weekStart)} to ${shortDate(report.weekEnd)}`,
    "",
    reportHeadline(report, firstName),
    "",
    `Days practised: ${report.daysPractised}/7`,
    `Questions answered: ${report.answered}`,
    `Accuracy: ${report.accuracy === null ? "n/a" : `${report.accuracy}%`}`,
    `Streak: ${report.streak} ${report.streak === 1 ? "day" : "days"}`,
  ];
  if (report.bySubject.length > 0) {
    lines.push("", "By subject:");
    for (const s of report.bySubject) {
      lines.push(`- ${subjectName(s.subject)}: ${s.answered} answered, ${s.accuracy}% correct`);
    }
  }
  if (report.weakestTopics.length > 0) {
    lines.push("", "Topics to work on:");
    for (const t of report.weakestTopics) {
      lines.push(`- ${t.topic} (${subjectName(t.subject)}, ${t.accuracy}%)`);
    }
  }
  return lines.join("\n");
}
