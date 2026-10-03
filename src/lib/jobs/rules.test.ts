import { describe, expect, it } from "vitest";
import { renderTemplate, TEMPLATES } from "@/config/templates";
import type { AnswerRow } from "@/lib/rules/progress";
import {
  encouragingLine,
  estimateCostUsd,
  isReportTime,
  joinNames,
  missedDaysInARow,
  reportDue,
  weeklyReportValues,
  weeklySummary,
} from "./rules";

describe("estimated cost", () => {
  const wa = (recipient: string, category = "utility", windowOpen = false) =>
    estimateCostUsd({ channel: "whatsapp", recipient, category, windowOpen });

  it("prices a template by the recipient's country and Meta's category", () => {
    expect(wa("+2348031234567")).toBe(0.0067);
    expect(wa("+2348031234567", "marketing")).toBe(0.0516);
    expect(wa("+447700900123")).toBe(0.022);
    expect(wa("+353861234567")).toBe(0.0232);
    expect(wa("+14165550123")).toBe(0.004); // Canada shares +1 with the US
    expect(wa("+27821234567")).toBe(0.0077); // anywhere else
    expect(wa("+2348031234567", "authentication")).toBe(0.0067);
    expect(wa("+2348031234567", "something new")).toBe(0.0516); // unknown: assume the dearest
  });

  it("is free for email and for utility templates inside the 24-hour window", () => {
    expect(
      estimateCostUsd({
        channel: "email",
        recipient: "a@b.c",
        category: "email",
        windowOpen: false,
      }),
    ).toBe(0);
    expect(wa("+447700900123", "utility", true)).toBe(0);
    expect(wa("+447700900123", "marketing", true)).toBe(0.0529);
  });
});

describe("names", () => {
  it("joins them the way people write them", () => {
    expect(joinNames([])).toBe("");
    expect(joinNames(["Ada"])).toBe("Ada");
    expect(joinNames(["Ada", "Chidi"])).toBe("Ada and Chidi");
    expect(joinNames(["Ada", "Chidi", "Emeka"])).toBe("Ada, Chidi and Emeka");
  });
});

describe("weekly report time", () => {
  const lagosSunday18 = { timezone: "Africa/Lagos", weekday: 0, hour: 18 };

  it("allows Saturday 18:00-23:00 and Sunday 07:00-21:00 only", () => {
    expect(isReportTime(6, 18)).toBe(true);
    expect(isReportTime(6, 23)).toBe(true);
    expect(isReportTime(6, 17)).toBe(false);
    expect(isReportTime(0, 7)).toBe(true);
    expect(isReportTime(0, 21)).toBe(true);
    expect(isReportTime(0, 22)).toBe(false);
    expect(isReportTime(1, 9)).toBe(false);
  });

  it("is due from the chosen hour, in the payer's own timezone, until Sunday ends there", () => {
    // Sunday 11 October 2026.
    expect(reportDue(lagosSunday18, new Date("2026-10-11T16:59:00Z"))).toEqual({
      due: false,
      weekStart: "2026-10-05",
    });
    expect(reportDue(lagosSunday18, new Date("2026-10-11T17:00:00Z")).due).toBe(true);
    expect(reportDue(lagosSunday18, new Date("2026-10-11T22:30:00Z")).due).toBe(true); // 23:30
    expect(reportDue(lagosSunday18, new Date("2026-10-11T23:00:00Z")).due).toBe(false); // Monday
    expect(reportDue(lagosSunday18, new Date("2026-10-10T20:00:00Z")).due).toBe(false); // Saturday
  });

  it("follows the payer's clocks: London summer time, and Sunday evening in Los Angeles", () => {
    const londonSat19 = { timezone: "Europe/London", weekday: 6, hour: 19 };
    // 10 October is British Summer Time (UTC+1): 19:00 there is 18:00 UTC.
    expect(reportDue(londonSat19, new Date("2026-10-10T17:59:00Z")).due).toBe(false);
    expect(reportDue(londonSat19, new Date("2026-10-10T18:00:00Z"))).toEqual({
      due: true,
      weekStart: "2026-10-05",
    });
    // In winter (GMT) the same choice is 19:00 UTC.
    expect(reportDue(londonSat19, new Date("2026-11-07T18:30:00Z")).due).toBe(false);
    expect(reportDue(londonSat19, new Date("2026-11-07T19:00:00Z")).due).toBe(true);
    const laSunday21 = { timezone: "America/Los_Angeles", weekday: 0, hour: 21 };
    // Sunday 21:00 in Los Angeles (PDT, UTC-7) is Monday 04:00 UTC.
    expect(reportDue(laSunday21, new Date("2026-10-12T04:00:00Z"))).toEqual({
      due: true,
      weekStart: "2026-10-05",
    });
  });
});

const answer = (day: string, correct: boolean, topic = "Algebra"): AnswerRow => ({
  answeredAt: new Date(`${day}T10:00:00Z`),
  correct,
  subject: "mathematics",
  topic,
  sessionId: day,
});
/** `n` answers on a day, `right` of them correct. */
const practice = (day: string, n: number, right: number, topic?: string) =>
  Array.from({ length: n }, (_, i) => answer(day, i < right, topic));

describe("weekly report contents", () => {
  const monday = "2026-10-05";

  it("counts the week's practice days and compares the score with last week", () => {
    const answers = [
      ...practice("2026-09-28", 5, 3), // last week: 60%
      ...practice("2026-10-05", 5, 4, "Concord"),
      ...practice("2026-10-06", 5, 4),
      ...practice("2026-10-07", 3, 2), // below 5: not a practice day
    ];
    const s = weeklySummary(answers, monday, "Ada");
    expect(s).toMatchObject({ daysPractised: 2, averageScore: 77, trendPoints: 17 });
    expect(s.line).toBe("Scores are climbing. Tell Ada you noticed!");
    expect(weeklyReportValues("Ada", s)).toEqual([
      "Ada",
      "2",
      "77%",
      "up 17 points on last week",
      expect.any(String),
      "Scores are climbing. Tell Ada you noticed!",
    ]);
    expect(weeklySummary(answers, monday, "Ada", 3).daysPractised).toBe(3); // setting
  });

  it("says something useful whatever kind of week it was", () => {
    const empty = weeklySummary([], monday, "Ada");
    expect(weeklyReportValues("Ada", empty)).toEqual([
      "Ada",
      "0",
      "none yet",
      "no questions answered this week",
      "none yet",
      "A fresh week starts on Monday: a few questions a day makes a real difference for Ada.",
    ]);
    const firstWeek = weeklySummary(practice("2026-10-05", 5, 5), monday, "Ada");
    expect(weeklyReportValues("Ada", firstWeek)[3]).toBe("no score last week to compare");
    const same = weeklySummary(
      [...practice("2026-09-29", 5, 4), ...practice("2026-10-06", 5, 4)],
      monday,
      "Ada",
    );
    expect(weeklyReportValues("Ada", same)[3]).toBe("the same as last week");
    const down = weeklySummary(
      [...practice("2026-09-29", 5, 5), ...practice("2026-10-06", 5, 3)],
      monday,
      "Ada",
    );
    expect(weeklyReportValues("Ada", down)[3]).toBe("down 40 points on last week");
    expect(down.line).toBe("A dip is normal. A word of encouragement will help Ada keep going.");
  });

  it("praises a habit when most days were practised", () => {
    expect(encouragingLine("Ada", { daysPractised: 5, averageScore: 70, trendPoints: 0 })).toBe(
      "Ada practised on most days. That habit is what moves grades.",
    );
    expect(encouragingLine("Ada", { daysPractised: 2, averageScore: 70, trendPoints: 2 })).toBe(
      "Every question counts. A quick message from you keeps Ada going.",
    );
  });

  it("fits the template, which Meta needs without new lines", () => {
    const values = weeklyReportValues("Ada", weeklySummary([], monday, "Ada"));
    const text = renderTemplate("weeklyReport", values);
    expect(text).toContain("Weekly KinPrep report for Ada: practised on 0 of 7 days.");
    expect(text).not.toMatch(/\{\{\d\}\}|\n/);
    expect(() => renderTemplate("weeklyReport", ["too few"])).toThrow(/needs 6 values/);
  });
});

describe("missed days in a row", () => {
  it("counts back from today to the last practice day", () => {
    const practised = new Set(["2026-10-08", "2026-10-09"]);
    expect(missedDaysInARow(practised, "2026-10-11", "2026-10-01")).toEqual({
      days: 2,
      since: "2026-10-10",
    });
    expect(missedDaysInARow(practised, "2026-10-09", "2026-10-01")).toEqual({
      days: 0,
      since: null,
    });
  });

  it("never counts days before the student was added", () => {
    expect(missedDaysInARow(new Set(), "2026-10-11", "2026-10-11")).toEqual({
      days: 1,
      since: "2026-10-11",
    });
    expect(missedDaysInARow(new Set(), "2026-10-11", "2026-10-09")).toEqual({
      days: 3,
      since: "2026-10-09",
    });
  });
});

describe("templates", () => {
  it("all follow Meta's rules: names, variables in order, no variable at either end", () => {
    for (const t of Object.values(TEMPLATES)) {
      expect(t.name).toMatch(/^kinprep_[a-z_]+$/);
      const used = [...t.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
      expect(used).toEqual(t.variables.map((_, i) => i + 1));
      expect(t.body).not.toMatch(/^\{\{|\}\}[.!]?$/);
      expect(t.body.length).toBeLessThanOrEqual(1024);
    }
  });
});
