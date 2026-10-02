import { describe, expect, it } from "vitest";
import { isSeniorBirthYear, subjectsProblem } from "./students";

describe("isSeniorBirthYear", () => {
  const now = new Date("2026-10-02T12:00:00Z");

  it("counts a student as 13+ only if they are 13 even with a late birthday", () => {
    expect(isSeniorBirthYear(2012, now)).toBe(true); // at least 13 all of 2026... and 14 by Dec
    expect(isSeniorBirthYear(2013, now)).toBe(false); // could still be 12
  });

  it("uses the Lagos year at New Year", () => {
    expect(isSeniorBirthYear(2013, new Date("2026-12-31T23:30:00Z"))).toBe(true);
  });
});

describe("subjectsProblem", () => {
  it("needs English plus exactly three subjects for JAMB", () => {
    expect(subjectsProblem("UTME", ["english", "mathematics", "physics", "biology"])).toBeNull();
    expect(subjectsProblem("UTME", ["mathematics", "physics", "biology"])).toMatch(/English/);
    expect(subjectsProblem("UTME", ["english", "physics"])).toMatch(/exactly three/);
  });

  it("allows any one to four subjects for other exams", () => {
    expect(subjectsProblem("WASSCE", ["biology"])).toBeNull();
    expect(subjectsProblem("BECE", [])).toMatch(/at least one/);
    expect(subjectsProblem("NECO", ["biology", "biology"])).toMatch(/once/);
  });
});
