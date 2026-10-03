import { describe, expect, it } from "vitest";
import type { Subject } from "@/config/pilot";
import type { AnswerRow } from "@/lib/rules/progress";
import { currentStreak, weekDots } from "./index";
import { nextReview, updateMastery } from "./mastery";
import { runwayDays } from "./runway";
import { planDailySet, type Candidate, type PickReason } from "./select";

const DAY = "2026-10-05"; // a Monday

/** A bank: `perTopic` questions in each topic, ids like "eng-concord-3". */
function bank(topics: Record<string, Subject>, perTopic: number): Candidate[] {
  return Object.entries(topics).flatMap(([topicId, subject]) =>
    Array.from({ length: perTopic }, (_, i) => ({
      id: `${topicId}-${i}`,
      subject,
      topicId,
      lastAnsweredDay: null,
      lastCorrectDay: null,
      nextReviewDay: null,
    })),
  );
}

const TOPICS: Record<string, Subject> = {
  concord: "english",
  lexis: "english",
  oral: "english",
  algebra: "mathematics",
  geometry: "mathematics",
  statistics: "mathematics",
};

const reasons = (plan: ReturnType<typeof planDailySet>) =>
  plan.picks.reduce<Partial<Record<PickReason, number>>>(
    (acc, p) => ({ ...acc, [p.reason]: (acc[p.reason] ?? 0) + 1 }),
    {},
  );

function answered(c: Candidate, day: string, correct: boolean): Candidate {
  return { ...c, lastAnsweredDay: day, lastCorrectDay: correct ? day : c.lastCorrectDay };
}

describe("weak-topic selection", () => {
  it("takes about 60% from the weakest topics with at least 5 attempts", () => {
    const plan = planDailySet({
      day: DAY,
      size: 10,
      candidates: bank(TOPICS, 10),
      mastery: [
        { topicId: "concord", attempts: 12, accuracy: 0.9 },
        { topicId: "lexis", attempts: 8, accuracy: 0.35 },
        { topicId: "oral", attempts: 4, accuracy: 0 }, // too few attempts to judge
        { topicId: "algebra", attempts: 6, accuracy: 0.5 },
        { topicId: "geometry", attempts: 20, accuracy: 0.42 },
      ],
    });
    const weak = plan.picks.filter((p) => p.reason === "weak");
    expect(weak).toHaveLength(6);
    // The three weakest judged topics, two each; never "oral" (4 attempts) or "concord" (90%).
    expect(weak.map((p) => p.topicId).sort()).toEqual([
      "algebra",
      "algebra",
      "geometry",
      "geometry",
      "lexis",
      "lexis",
    ]);
    // 20% new topics: the ones never attempted ("statistics"); "oral" has been seen.
    expect(plan.picks.filter((p) => p.reason === "new").map((p) => p.topicId)).toEqual([
      "statistics",
      "statistics",
    ]);
    expect(plan.shortages).toEqual([]);
  });

  it("ignores mastery for topics outside the student's subjects and class", () => {
    const plan = planDailySet({
      day: DAY,
      size: 5,
      candidates: bank({ concord: "english" }, 10),
      mastery: [{ topicId: "photosynthesis", attempts: 30, accuracy: 0.1 }],
    });
    expect(plan.picks.every((p) => p.topicId === "concord")).toBe(true);
    expect(plan.picks).toHaveLength(5);
  });

  it("moves on to the next weakest topic when a weak topic has no questions left", () => {
    const candidates = bank({ a: "english", b: "english", c: "english" }, 3).map((q) =>
      q.topicId === "a" ? answered(q, "2026-10-01", true) : q,
    );
    const plan = planDailySet({
      day: DAY,
      size: 3,
      candidates,
      mastery: [
        { topicId: "a", attempts: 9, accuracy: 0.1 }, // weakest, but every question used recently
        { topicId: "b", attempts: 9, accuracy: 0.3 },
        { topicId: "c", attempts: 9, accuracy: 0.9 },
      ],
      mix: { weakTopics: 1, review: 0, newTopics: 0 },
    });
    expect(plan.picks.map((p) => [p.topicId, p.reason])).toEqual([
      ["b", "weak"],
      ["b", "weak"],
      ["b", "weak"],
    ]);
  });

  it("breaks accuracy ties by attempts: the more evidence, the weaker", () => {
    const plan = planDailySet({
      day: DAY,
      size: 1,
      candidates: bank({ a: "english", b: "english" }, 3),
      mastery: [
        { topicId: "a", attempts: 5, accuracy: 0.4 },
        { topicId: "b", attempts: 9, accuracy: 0.4 },
      ],
      mix: { weakTopics: 1, review: 0, newTopics: 0 },
    });
    expect(plan.picks[0]).toMatchObject({ topicId: "b", reason: "weak" });
  });
});

describe("spaced-review timing", () => {
  it("re-asks a wrong answer after 1 day, then 3, then 7, then stops", () => {
    let state = nextReview(null, false, "2026-10-05");
    expect(state).toEqual({ step: 0, nextReviewDay: "2026-10-06" });
    state = nextReview(state, true, "2026-10-06");
    expect(state).toEqual({ step: 1, nextReviewDay: "2026-10-09" });
    state = nextReview(state, true, "2026-10-09");
    expect(state).toEqual({ step: 2, nextReviewDay: "2026-10-16" });
    state = nextReview(state, true, "2026-10-16");
    expect(state).toEqual({ step: 3, nextReviewDay: null });
    // Done: another right answer changes nothing.
    expect(nextReview(state, true, "2026-11-30")).toBe(state);
  });

  it("starts again at 1 day after a wrong answer at any stage", () => {
    expect(nextReview({ step: 2, nextReviewDay: "2026-10-16" }, false, "2026-10-16")).toEqual({
      step: 0,
      nextReviewDay: "2026-10-17",
    });
  });

  it("schedules nothing for a question answered right first time", () => {
    expect(nextReview(null, true, DAY)).toBeNull();
  });

  it("counts intervals from the day it was actually answered, so a late review isn't rushed", () => {
    // Due on the 6th, but answered (correctly) on the 10th: next is 3 days after the 10th.
    expect(nextReview({ step: 0, nextReviewDay: "2026-10-06" }, true, "2026-10-10")).toEqual({
      step: 1,
      nextReviewDay: "2026-10-13",
    });
  });

  it("asks due reviews first (most overdue first, up to 20%), and never early", () => {
    const candidates = bank(TOPICS, 10).map((c, i) =>
      i < 3
        ? { ...answered(c, "2026-10-01", false), nextReviewDay: `2026-10-0${2 + i}` } // due
        : i < 5
          ? { ...answered(c, "2026-10-04", false), nextReviewDay: "2026-10-06" } // not yet
          : c,
    );
    const plan = planDailySet({ day: DAY, size: 10, candidates, mastery: [] });
    const review = plan.picks.filter((p) => p.reason === "review").map((p) => p.questionId);
    expect(review.sort()).toEqual(["concord-0", "concord-1"]); // the two most overdue
    const ids = plan.picks.map((p) => p.questionId);
    expect(ids).not.toContain("concord-3");
    expect(ids).not.toContain("concord-4");
  });
});

describe("no repeats", () => {
  it("never repeats a question answered correctly in the last 30 days while the bank lasts", () => {
    const candidates = bank(TOPICS, 4).map((c, i) =>
      i % 2 === 0 ? answered(c, "2026-09-20", true) : c,
    );
    const plan = planDailySet({ day: DAY, size: 10, candidates, mastery: [] });
    expect(plan.picks).toHaveLength(10);
    for (const p of plan.picks) {
      expect(candidates.find((c) => c.id === p.questionId)!.lastCorrectDay).toBeNull();
    }
    expect(plan.shortages).toEqual([]);
  });

  it("allows a question answered correctly more than 30 days ago, after the fresh ones", () => {
    const candidates = [
      answered(bank({ concord: "english" }, 1)[0]!, "2026-09-04", true), // 31 days ago
      answered({ ...bank({ concord: "english" }, 2)[1]! }, "2026-09-06", true), // 29 days ago
      { ...bank({ concord: "english" }, 3)[2]! }, // fresh
    ];
    const plan = planDailySet({ day: DAY, size: 2, candidates, mastery: [] });
    expect(plan.picks.map((p) => p.questionId)).toEqual(
      expect.arrayContaining(["concord-2", "concord-0"]),
    );
    expect(plan.picks.map((p) => p.questionId)).not.toContain("concord-1");
    expect(plan.shortages).toEqual([]);
  });

  it("never asks the same question twice in one day, even as a top-up", () => {
    const candidates = bank({ concord: "english" }, 3).map((c) => answered(c, DAY, true));
    const plan = planDailySet({ day: DAY, size: 3, candidates, mastery: [] });
    expect(plan.picks).toEqual([]);
  });

  it("breaks exact ties (same due day, same topic stats, same answer day) the same way each time", () => {
    const [a, b, c, d] = bank({ x: "english", y: "english" }, 2);
    const sameDue = [a!, b!].map((q) => ({
      ...answered(q, "2026-10-01", false),
      nextReviewDay: "2026-10-02",
    }));
    const sameCorrect = [c!, d!].map((q) => answered(q, "2026-10-01", true));
    const input = {
      day: DAY,
      size: 4,
      candidates: [...sameDue, ...sameCorrect],
      mastery: [
        { topicId: "x", attempts: 6, accuracy: 0.5 },
        { topicId: "y", attempts: 6, accuracy: 0.5 },
      ],
      mix: { review: 0.25, newTopics: 0, weakTopics: 1 },
    };
    const plan = planDailySet(input);
    expect(plan.picks).toHaveLength(4);
    expect(reasons(plan)).toEqual({ review: 1, topup: 3 });
    expect(planDailySet(input)).toEqual(plan);
  });

  it("is repeatable for a day and varies from day to day", () => {
    const input = { size: 6, candidates: bank(TOPICS, 10), mastery: [] };
    const a = planDailySet({ ...input, day: DAY });
    expect(planDailySet({ ...input, day: DAY })).toEqual(a);
    expect(planDailySet({ ...input, day: "2026-10-06" }).picks).not.toEqual(a.picks);
  });
});

describe("the shortage fallback", () => {
  it("tops up with review questions when the bank runs out, and reports every empty topic", () => {
    const fresh = bank({ concord: "english", algebra: "mathematics" }, 2);
    const reviews = [
      // Under review but not due yet; asked before ones answered correctly.
      { ...answered(fresh[0]!, "2026-10-04", false), nextReviewDay: "2026-10-07" },
      // Answered correctly recently: asked last, oldest first.
      answered(fresh[1]!, "2026-09-30", true),
      answered(fresh[2]!, "2026-10-02", true),
    ];
    const candidates = [...reviews, fresh[3]!];
    const plan = planDailySet({ day: DAY, size: 10, candidates, mastery: [] });
    expect(reasons(plan)).toEqual({ new: 1, topup: 3 });
    const topups = plan.picks.filter((p) => p.reason === "topup").map((p) => p.questionId);
    expect(topups.sort()).toEqual(["algebra-0", "concord-0", "concord-1"]);
    expect(plan.shortages).toEqual([
      { subject: "english", topicId: "concord" },
      { subject: "mathematics", topicId: "algebra" },
    ]);
  });

  it("tops up in order: due reviews, then scheduled reviews, then recent correct answers", () => {
    const [due, scheduled, correctOld, correctNew] = bank({ t: "english" }, 4);
    const plan = planDailySet({
      day: DAY,
      size: 3,
      candidates: [
        answered(correctNew!, "2026-10-03", true),
        { ...answered(scheduled!, "2026-10-04", false), nextReviewDay: "2026-10-08" },
        answered(correctOld!, "2026-09-25", true),
        { ...answered(due!, "2026-10-01", false), nextReviewDay: "2026-10-02" },
      ],
      mastery: [],
      mix: { review: 0 }, // so the due review only comes in as a top-up
    });
    const order = plan.picks.map((p) => p.questionId);
    expect(plan.picks.every((p) => p.reason === "topup")).toBe(true);
    expect(order.sort()).toEqual(["t-0", "t-1", "t-2"]); // not t-3, the most recent correct
  });

  it("reports nothing and picks nothing extra when the bank can fill the set", () => {
    const plan = planDailySet({ day: DAY, size: 10, candidates: bank(TOPICS, 2), mastery: [] });
    expect(plan.picks).toHaveLength(10);
    expect(plan.shortages).toEqual([]);
    expect(reasons(plan).topup).toBeUndefined();
  });

  it("returns an empty set for a size of 0", () => {
    expect(planDailySet({ day: DAY, size: 0, candidates: bank(TOPICS, 2), mastery: [] })).toEqual({
      picks: [],
      shortages: [],
    });
  });
});

describe("streaks across midnight (Africa/Lagos, UTC+1)", () => {
  const row = (iso: string): AnswerRow => ({
    answeredAt: new Date(iso),
    correct: true,
    subject: "english",
    topic: "Concord",
    sessionId: "s",
  });
  const many = (iso: string, n: number) =>
    Array.from({ length: n }, (_, i) => row(new Date(Date.parse(iso) + i * 1000).toISOString()));

  it("splits answers either side of Lagos midnight into different days", () => {
    // 22:59 UTC on the 4th is 23:59 on the 4th in Lagos; 23:01 UTC is 00:01 on the 5th.
    const answers = [...many("2026-10-04T22:55:00Z", 3), ...many("2026-10-04T23:01:00Z", 3)];
    expect(currentStreak(answers, "2026-10-05")).toBe(0); // 3 + 3, neither day reaches 5
    const both = [...many("2026-10-04T22:54:00Z", 5), ...many("2026-10-04T23:01:00Z", 5)];
    expect(currentStreak(both, "2026-10-05")).toBe(2);
  });

  it("counts an answer at 00:30 Lagos for the new day, though it's still yesterday in UTC", () => {
    const answers = [...many("2026-10-03T12:00:00Z", 5), ...many("2026-10-04T23:30:00Z", 5)];
    // UTC says the 3rd and the 4th; Lagos says the 3rd and the 5th: no unbroken run.
    expect(currentStreak(answers, "2026-10-05")).toBe(1);
  });

  it("uses the threshold setting", () => {
    const answers = many("2026-10-05T09:00:00Z", 3);
    expect(currentStreak(answers, DAY)).toBe(0); // default 5
    expect(currentStreak(answers, DAY, 3)).toBe(1);
    expect(weekDots(answers, DAY, 3)[0]!.practised).toBe(true);
    expect(weekDots(answers, DAY)[0]!.practised).toBe(false);
  });

  it("doesn't break the streak before today is done", () => {
    const answers = many("2026-10-04T09:00:00Z", 5);
    expect(currentStreak(answers, DAY)).toBe(1);
  });
});

describe("topic mastery", () => {
  it("averages the first answers, then weighs recent ones more", () => {
    let m = updateMastery(null, true);
    expect(m).toEqual({ attempts: 1, correct: 1, accuracy: 1 });
    m = updateMastery(m, false);
    expect(m.accuracy).toBe(0.5);
    for (let i = 0; i < 3; i++) m = updateMastery(m, false);
    expect(m).toEqual({ attempts: 5, correct: 1, accuracy: 0.2 }); // still a plain average
    m = updateMastery(m, true); // now 20% weight on the newest answer
    expect(m.accuracy).toBe(0.36);
    let improving = m;
    for (let i = 0; i < 10; i++) improving = updateMastery(improving, true);
    expect(improving.accuracy).toBeGreaterThan(0.9); // recovers fast; a plain average would be 0.75
    expect(improving.correct / improving.attempts).toBe(12 / 16);
  });
});

describe("bank runway", () => {
  it("is the fresh questions left over what an average student uses a day", () => {
    // 10 a day, 80% fresh, over 2 subjects = 4 fresh a day in this subject.
    expect(
      runwayDays({ students: [{ fresh: 60, subjects: 2 }], bankSize: 75, questionsPerDay: 10 }),
    ).toBe(15);
    expect(
      runwayDays({
        students: [
          { fresh: 60, subjects: 2 },
          { fresh: 20, subjects: 4 },
        ],
        bankSize: 75,
        questionsPerDay: 10,
      }),
    ).toBe(13); // 40 fresh on average / 3 a day on average
  });

  it("assumes a new student taking every subject when nobody is active", () => {
    expect(runwayDays({ students: [], bankSize: 150, questionsPerDay: 10 })).toBe(75);
    expect(runwayDays({ students: [], bankSize: 150, questionsPerDay: 0 })).toBe(0);
  });
});
