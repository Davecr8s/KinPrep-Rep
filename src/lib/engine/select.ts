import { DAILY_SET_MIX, type Subject } from "@/config/pilot";
import { addDays, type Day } from "@/lib/rules/days";

// Choosing the day's set: a pure function of the student's history, so every rule is unit
// tested without a database. src/lib/engine/index.ts loads the inputs and saves the result.
//
// Order of filling:
//   1. review    questions answered wrongly and now due for spaced review (about 20%)
//   2. weak      the weakest topics: lowest rolling accuracy, enough attempts (about 60%)
//   3. new       topics the student hasn't seen yet (about 20%)
//   4. fill      any other question they can be asked, if a share above couldn't be filled
//   5. topup     only when the bank is exhausted: review questions, including ones answered
//                correctly in the last 30 days; the empty topics are reported as shortages
// A question answered correctly in the last 30 days is never asked in steps 1-4, and no question
// is asked twice on the same day.

export type Candidate = {
  id: string;
  subject: Subject;
  topicId: string;
  /** The Lagos day the student last answered it, if ever. */
  lastAnsweredDay: Day | null;
  /** The Lagos day the student last answered it correctly, if ever. */
  lastCorrectDay: Day | null;
  /** When spaced review is due; null if the question isn't under review. */
  nextReviewDay: Day | null;
};

export type TopicStat = { topicId: string; attempts: number; accuracy: number };

export type PickReason = "review" | "weak" | "new" | "fill" | "topup";
export type Pick = { questionId: string; subject: Subject; topicId: string; reason: PickReason };
export type Shortage = { subject: Subject; topicId: string };
export type DailySetPlan = { picks: Pick[]; shortages: Shortage[] };

export type Mix = {
  weak: number;
  review: number;
  newTopics: number;
  weakMinAttempts: number;
  weakTopics: number;
  noRepeatDays: number;
};

export type DailySetInput = {
  day: Day;
  size: number;
  /** Approved questions in the student's subjects and class. */
  candidates: readonly Candidate[];
  /** The student's rolling accuracy per topic. */
  mastery: readonly TopicStat[];
  mix?: Partial<Mix>;
};

/** FNV-1a: a stable per-day shuffle for ties, so sets vary day to day but tests are repeatable. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const byDay = (a: Day | null, b: Day | null) => (a ?? "").localeCompare(b ?? "");

export function planDailySet(input: DailySetInput): DailySetPlan {
  const mix: Mix = { ...DAILY_SET_MIX, ...input.mix };
  const { day, size } = input;
  const tie = (id: string) => hash(`${day}:${id}`);
  const recentCutoff = addDays(day, -mix.noRepeatDays);

  // Never the same question twice in one day.
  const usable = input.candidates.filter((c) => c.lastAnsweredDay !== day);
  const underReview = (c: Candidate) => c.nextReviewDay !== null;
  const due = (c: Candidate) => c.nextReviewDay !== null && c.nextReviewDay <= day;
  const recentlyCorrect = (c: Candidate) =>
    c.lastCorrectDay !== null && c.lastCorrectDay > recentCutoff;
  /** Can be asked as a weak, new-topic or fill question. */
  const eligible = (c: Candidate) => !underReview(c) && !recentlyCorrect(c);
  /** Never answered first, then the longest ago. */
  const freshest = (a: Candidate, b: Candidate) =>
    Number(a.lastAnsweredDay !== null) - Number(b.lastAnsweredDay !== null) ||
    byDay(a.lastAnsweredDay, b.lastAnsweredDay) ||
    tie(a.id) - tie(b.id);

  const picks: Pick[] = [];
  const picked = new Set<string>();
  const free = (c: Candidate) => !picked.has(c.id);
  const room = () => size - picks.length;
  const take = (c: Candidate, reason: PickReason) => {
    picked.add(c.id);
    picks.push({ questionId: c.id, subject: c.subject, topicId: c.topicId, reason });
  };
  /** One from each queue in turn, until `limit` are taken or the queues run dry. */
  const roundRobin = (queues: Candidate[][], limit: number, reason: PickReason) => {
    const next = queues.map(() => 0);
    let taken = 0;
    for (let progress = true; progress && taken < limit;) {
      progress = false;
      queues.forEach((queue, i) => {
        if (taken >= limit) return;
        while (next[i]! < queue.length && !free(queue[next[i]!]!)) next[i]! += 1;
        const c = queue[next[i]!];
        if (!c) return;
        take(c, reason);
        next[i]! += 1;
        taken += 1;
        progress = true;
      });
    }
  };
  const queueFor = (topicId: string) =>
    usable.filter((c) => c.topicId === topicId && eligible(c)).sort(freshest);

  const reviewQuota = Math.round(size * mix.review);
  const newQuota = Math.round(size * mix.newTopics);
  const weakQuota = Math.max(0, size - reviewQuota - newQuota);

  // 1. Spaced review: due questions, most overdue first.
  const dueNow = usable
    .filter(due)
    .sort((a, b) => byDay(a.nextReviewDay, b.nextReviewDay) || tie(a.id) - tie(b.id));
  for (const c of dueNow.slice(0, Math.max(0, Math.min(reviewQuota, room())))) take(c, "review");

  // 2. The weakest topics with enough attempts to judge, spread over the few weakest that still
  //    have questions to ask (a weak topic that has run dry hands over to the next weakest).
  const topicsInPlay = new Set(input.candidates.map((c) => c.topicId));
  const topicsWithQuestions = new Set(usable.filter(eligible).map((c) => c.topicId));
  const weakTopics = input.mastery
    .filter((m) => m.attempts >= mix.weakMinAttempts && topicsWithQuestions.has(m.topicId))
    .sort(
      (a, b) =>
        a.accuracy - b.accuracy || b.attempts - a.attempts || tie(a.topicId) - tie(b.topicId),
    )
    .slice(0, mix.weakTopics)
    .map((m) => m.topicId);
  roundRobin(weakTopics.map(queueFor), Math.min(weakQuota, room()), "weak");

  // 3. Topics not seen yet, one question from each in turn.
  const seen = new Set(input.mastery.filter((m) => m.attempts > 0).map((m) => m.topicId));
  const unseenTopics = [...topicsInPlay]
    .filter((t) => !seen.has(t))
    .sort((a, b) => tie(a) - tie(b));
  roundRobin(unseenTopics.map(queueFor), Math.min(newQuota, room()), "new");

  // 4. Any other question they can be asked, spread across their subjects, least-practised topics
  //    first so every topic soon has enough attempts to be judged.
  const attempts = new Map(input.mastery.map((m) => [m.topicId, m.attempts]));
  const leastPractised = (a: Candidate, b: Candidate) =>
    (attempts.get(a.topicId) ?? 0) - (attempts.get(b.topicId) ?? 0) || freshest(a, b);
  const subjects = [...new Set(usable.map((c) => c.subject))].sort();
  roundRobin(
    subjects.map((s) => usable.filter((c) => c.subject === s && eligible(c)).sort(leastPractised)),
    room(),
    "fill",
  );

  // 5. The bank can't fill the set: top up with review questions and report the empty topics.
  const shortages: Shortage[] = [];
  if (room() > 0) {
    const reviewOrder = (c: Candidate) => (due(c) ? 0 : underReview(c) ? 1 : 2);
    const topups = usable
      .filter(free)
      .sort(
        (a, b) =>
          reviewOrder(a) - reviewOrder(b) ||
          byDay(a.nextReviewDay, b.nextReviewDay) ||
          byDay(a.lastCorrectDay, b.lastCorrectDay) ||
          tie(a.id) - tie(b.id),
      );
    for (const c of topups.slice(0, room())) take(c, "topup");
    const reported = new Set<string>();
    for (const c of input.candidates) {
      if (reported.has(c.topicId)) continue;
      reported.add(c.topicId);
      shortages.push({ subject: c.subject, topicId: c.topicId });
    }
  }

  // Mix the order so the set doesn't come in blocks of one kind.
  picks.sort((a, b) => tie(a.questionId) - tie(b.questionId));
  return { picks, shortages };
}
