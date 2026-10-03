import { beforeAll, describe, expect, it } from "vitest";
import { formatSimulation, simulate, SIM_DAYS, type SimResult } from "./engine-simulation";

// The engine's "Done when": 30 days for one student with 75 questions per subject. No fresh
// repeats until the bank runs out, then review mode with the shortage logged.

let sim: SimResult;

beforeAll(async () => {
  sim = await simulate();
  // `npm run simulate:engine` prints the day-by-day table.
  if (process.env.npm_lifecycle_event === "simulate:engine") console.log(formatSimulation(sim));
}, 180_000);

const firstTopupIndex = () => sim.days.findIndex((d) => d.topup > 0);

describe("30 days for one student, 75 questions per subject", () => {
  it("asks a full set every day", () => {
    expect(sim.days).toHaveLength(SIM_DAYS);
    for (const d of sim.days) expect(d.asked).toBe(10);
  });

  it("repeats no fresh question until the bank runs out, and logs no shortage before then", () => {
    const out = firstTopupIndex();
    expect(out).toBeGreaterThan(10); // 150 questions last more than 10 days at 10 a day
    for (const d of sim.days.slice(0, out)) {
      expect(d.freshRepeats, d.day).toBe(0);
      expect(d.topup, d.day).toBe(0);
      expect(d.shortagesLogged, d.day).toBe(0);
    }
  });

  it("then switches to review mode, with the shortage logged for each topic every day", () => {
    const out = firstTopupIndex();
    expect(out).toBeGreaterThan(0);
    expect(sim.days[out]!.freshLeft).toBe(0);
    for (const d of sim.days.slice(out + 1)) {
      expect(d.topup + d.review, d.day).toBe(10);
      expect(d.weak + d.new + d.fill, d.day).toBe(0);
      expect(d.shortagesLogged, d.day).toBe(10); // 5 topics x 2 subjects
    }
    expect(sim.totalShortageEvents).toBe((SIM_DAYS - out) * 10);
  });

  it("mixes in spaced review of wrong answers and, once judged, the weakest topics", () => {
    expect(sim.days.reduce((n, d) => n + d.badReviews, 0)).toBe(0);
    expect(sim.days.some((d) => d.review > 0)).toBe(true);
    // A topic needs 5 attempts before it can be judged weak: with 10 topics sharing 10 questions
    // a day, that takes about 4 days; from then on about 60% of the set is weak-topic work.
    expect(sim.days[0]!.weak).toBe(0);
    expect(sim.days.slice(4, firstTopupIndex()).every((d) => d.weak >= 4)).toBe(true);
  });

  it("runs the bank runway down to zero as fresh questions run out", () => {
    expect(sim.days[0]!.runway).toEqual({ english: 18, mathematics: 18 }); // 75 / (10 x 80% / 2)
    const out = firstTopupIndex();
    expect(sim.days[out + 1]!.runway).toEqual({ english: 0, mathematics: 0 });
  });

  it("never asks questions meant for other classes", () => {
    expect(sim.juniorOnlyAsked).toBe(0);
  });

  it("keeps topic mastery and review dates in step with the answers", async () => {
    const [m] = (
      await sim.db.query<{ attempts: number; answers: number }>(
        `select (select sum(attempts)::int from public.topic_mastery) as attempts,
                (select count(*)::int from public.answers) as answers`,
      )
    ).rows;
    expect(m!.attempts).toBe(m!.answers);
    // Review dates are the start of a Lagos day (23:00 UTC).
    const { rows } = await sim.db.query<{ hour: number }>(
      `select distinct extract(hour from next_review_at at time zone 'UTC')::int as hour
       from public.question_reviews where next_review_at is not null`,
    );
    expect(rows).toEqual([{ hour: 23 }]);
  });
});
