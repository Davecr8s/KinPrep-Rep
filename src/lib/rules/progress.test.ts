import { describe, expect, it } from "vitest";
import { STREAK_DAY_THRESHOLD, type Subject } from "@/config/pilot";
import {
  currentStreak,
  recentSessions,
  reportHeadline,
  reportText,
  weakestTopics,
  weekDots,
  weeklyAccuracy,
  weeklyReport,
  type AnswerRow,
} from "./progress";

let seq = 0;
/** `n` answers at noon Lagos time on `day`, the first `correct` of them right. */
function answersOn(
  day: string,
  n: number,
  { correct = n, subject = "mathematics" as Subject, topic = "Algebra", session = `s-${day}` } = {},
): AnswerRow[] {
  return Array.from({ length: n }, (_, i) => ({
    answeredAt: new Date(Date.parse(`${day}T11:00:00Z`) + (seq++ % 1000) * 1000 + i),
    correct: i < correct,
    subject,
    topic,
    sessionId: session,
  }));
}

const FULL = STREAK_DAY_THRESHOLD;

describe("weekDots", () => {
  it("fills a dot only for days reaching the threshold, Monday to Sunday", () => {
    const answers = [
      ...answersOn("2026-10-05", FULL), // Monday
      ...answersOn("2026-10-06", FULL - 1), // Tuesday: not enough
      ...answersOn("2026-10-07", FULL + 3), // Wednesday
    ];
    const dots = weekDots(answers, "2026-10-08");
    expect(dots.map((d) => d.practised)).toEqual([true, false, true, false, false, false, false]);
    expect(dots[3]).toMatchObject({ day: "2026-10-08", today: true, future: false });
    expect(dots[4]).toMatchObject({ future: true, today: false });
  });
});

describe("currentStreak", () => {
  const three = [
    ...answersOn("2026-10-05", FULL),
    ...answersOn("2026-10-06", FULL),
    ...answersOn("2026-10-07", FULL),
  ];

  it("counts consecutive practice days ending today", () => {
    expect(currentStreak([...three, ...answersOn("2026-10-08", FULL)], "2026-10-08")).toBe(4);
  });

  it("keeps the streak alive while today isn't done yet", () => {
    expect(currentStreak([...three, ...answersOn("2026-10-08", 1)], "2026-10-08")).toBe(3);
  });

  it("is zero after a missed day", () => {
    expect(currentStreak(three, "2026-10-09")).toBe(0);
    expect(currentStreak([], "2026-10-09")).toBe(0);
  });
});

describe("weeklyAccuracy", () => {
  it("gives 8 weeks oldest first, with null for weeks without answers", () => {
    const answers = [
      ...answersOn("2026-10-07", 10, { correct: 7 }),
      ...answersOn("2026-09-30", 4, { correct: 1 }),
      ...answersOn("2026-01-01", 5), // too old, ignored
    ];
    const series = weeklyAccuracy(answers, "2026-10-08");
    expect(series).toHaveLength(8);
    expect(series[0]!.weekStart).toBe("2026-08-17");
    expect(series.at(-1)).toEqual({ weekStart: "2026-10-05", answered: 10, accuracy: 70 });
    expect(series.at(-2)).toEqual({ weekStart: "2026-09-28", answered: 4, accuracy: 25 });
    expect(series[0]).toEqual({ weekStart: "2026-08-17", answered: 0, accuracy: null });
  });
});

describe("weakestTopics", () => {
  const answers = [
    ...answersOn("2026-10-05", 4, { correct: 1, topic: "Vectors", subject: "physics" }),
    ...answersOn("2026-10-05", 6, { correct: 3, topic: "Algebra" }),
    ...answersOn("2026-10-05", 3, { correct: 3, topic: "Cells", subject: "biology" }),
    ...answersOn("2026-10-05", 2, { correct: 0, topic: "Concord", subject: "english" }), // too few
    ...answersOn("2026-10-05", 4, { correct: 2, topic: "Geometry" }),
  ];

  it("lists the lowest-accuracy topics with enough attempts, ties by most attempts", () => {
    expect(weakestTopics(answers)).toEqual([
      { subject: "physics", topic: "Vectors", attempts: 4, accuracy: 25 },
      { subject: "mathematics", topic: "Algebra", attempts: 6, accuracy: 50 },
      { subject: "mathematics", topic: "Geometry", attempts: 4, accuracy: 50 },
    ]);
  });

  it("can lower the attempt bar and breaks remaining ties by name", () => {
    const tied = [
      ...answersOn("2026-10-05", 2, { correct: 1, topic: "Bravo" }),
      ...answersOn("2026-10-05", 2, { correct: 1, topic: "Alpha" }),
    ];
    expect(weakestTopics(tied, { minAttempts: 2 }).map((t) => t.topic)).toEqual(["Alpha", "Bravo"]);
  });
});

describe("recentSessions", () => {
  it("summarises sessions newest first, with their subjects", () => {
    const answers = [
      ...answersOn("2026-10-05", 3, { correct: 2, session: "a" }),
      ...answersOn("2026-10-07", 2, { correct: 1, session: "b", subject: "physics" }),
      ...answersOn("2026-10-07", 1, { correct: 1, session: "b", subject: "biology" }),
    ];
    const sessions = recentSessions(answers);
    expect(sessions.map((s) => s.sessionId)).toEqual(["b", "a"]);
    expect(sessions[0]).toMatchObject({
      day: "2026-10-07",
      answered: 3,
      correct: 2,
      subjects: ["physics", "biology"],
    });
    expect(recentSessions(answers, 1)).toHaveLength(1);
  });

  it("dates a session by its earliest answer, whatever the order", () => {
    const late = answersOn("2026-10-07", 1, { session: "x" });
    const early = answersOn("2026-10-06", 1, { session: "x" });
    expect(recentSessions([...late, ...early])[0]).toMatchObject({
      day: "2026-10-06",
      answered: 2,
    });
  });
});

describe("weeklyReport and its WhatsApp text", () => {
  const answers = [
    ...answersOn("2026-09-27", FULL), // previous Sunday: part of the streak only
    ...answersOn("2026-09-28", FULL, { correct: 4 }),
    ...answersOn("2026-09-29", FULL, { correct: 3, subject: "english", topic: "Concord" }),
    ...answersOn("2026-09-30", 2, { correct: 0, subject: "english", topic: "Concord" }),
    ...answersOn("2026-10-05", FULL), // next week: ignored
  ];
  const report = weeklyReport(answers, "2026-09-28");

  it("covers Monday to Sunday only", () => {
    expect(report).toMatchObject({
      weekStart: "2026-09-28",
      weekEnd: "2026-10-04",
      daysPractised: 2,
      answered: 12,
      accuracy: 58,
      streak: 0,
    });
    expect(report.bySubject).toEqual([
      { subject: "english", answered: 7, accuracy: 43 },
      { subject: "mathematics", answered: 5, accuracy: 80 },
    ]);
    expect(report.weakestTopics[0]).toMatchObject({ topic: "Concord", accuracy: 43 });
  });

  it("counts the streak as it stood on Sunday", () => {
    const streaky = [
      ...answersOn("2026-10-02", FULL),
      ...answersOn("2026-10-03", FULL),
      ...answersOn("2026-10-04", FULL),
    ];
    expect(weeklyReport(streaky, "2026-09-28").streak).toBe(3);
  });

  it("writes the same figures as plain text for WhatsApp", () => {
    const text = reportText(report, "Ada");
    expect(text).toContain("KinPrep weekly report for Ada");
    expect(text).toContain("28 Sept to 4 Oct");
    expect(text).toContain("Days practised: 2/7");
    expect(text).toContain("Questions answered: 12");
    expect(text).toContain("Accuracy: 58%");
    expect(text).toContain("Streak: 0 days");
    expect(text).toContain("- English: 7 answered, 43% correct");
    expect(text).toContain("- Concord (English, 43%)");
  });

  it("handles an empty week", () => {
    const empty = weeklyReport([], "2026-09-28");
    expect(reportText(empty, "Ada")).toContain("Accuracy: n/a");
    expect(reportText({ ...empty, streak: 1 }, "Ada")).toContain("Streak: 1 day");
    expect(reportText(empty, "Ada")).not.toContain("By subject");
  });

  it("chooses a headline by days practised", () => {
    const at = (daysPractised: number) => reportHeadline({ ...report, daysPractised }, "Ada");
    expect(at(6)).toMatch(/^Brilliant/);
    expect(at(3)).toMatch(/^Good effort/);
    expect(at(1)).toMatch(/encouragement/);
    expect(at(0)).toMatch(/didn't practise/);
  });
});
