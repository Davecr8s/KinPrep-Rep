import type { Subject } from "@/config/pilot";
import { lagosYear } from "./days";

/**
 * 13 or over, judged from birth year only: true only if the student is 13 even with the latest
 * possible birthday (Lagos year - birth year >= 14). Mirrors public.is_senior_birth_year in SQL.
 * BUILD_PLAN decision 1 (recommended rule, pending confirmation).
 */
export function isSeniorBirthYear(birthYear: number, now: Date): boolean {
  return lagosYear(now) - birthYear >= 14;
}

export type Exam = "BECE" | "WASSCE" | "NECO" | "UTME";

/** Why a subject choice is invalid for an exam, or null if it's fine. */
export function subjectsProblem(exam: Exam, subjects: readonly Subject[]): string | null {
  if (subjects.length === 0) return "Choose at least one subject.";
  if (new Set(subjects).size !== subjects.length) return "Each subject can only be chosen once.";
  if (exam === "UTME") {
    // JAMB: Use of English plus three other subjects.
    if (!subjects.includes("english")) return "JAMB (UTME) needs English plus three subjects.";
    if (subjects.length !== 4) return "JAMB (UTME) needs English plus exactly three subjects.";
  }
  return null;
}
