import type { Subject } from "@/config/pilot";

// Display names shared by pages. Plain English (CLAUDE.md brand voice).

export const CLASSES = ["JSS1", "JSS2", "SS1", "SS2", "SS3", "UTME"] as const;
export type StudentClass = (typeof CLASSES)[number];

export const CLASS_LABELS: Record<StudentClass, string> = {
  JSS1: "JSS1",
  JSS2: "JSS2",
  SS1: "SS1",
  SS2: "SS2",
  SS3: "SS3",
  UTME: "UTME candidate (finished school)",
};

export const EXAMS = ["BECE", "WASSCE", "NECO", "UTME"] as const;
export type Exam = (typeof EXAMS)[number];

export const EXAM_LABELS: Record<Exam, string> = {
  BECE: "BECE (Junior WAEC)",
  WASSCE: "WASSCE (WAEC)",
  NECO: "NECO",
  UTME: "UTME (JAMB)",
};

export const SUBJECT_LABELS: Record<Subject, string> = {
  english: "English",
  mathematics: "Mathematics",
  physics: "Physics",
  biology: "Biology",
};

export const LANGUAGE_LABELS = { en: "English", pcm: "Pidgin (with English)" } as const;

export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export function hourLabel(hour: number): string {
  const suffix = hour < 12 ? "am" : "pm";
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}${suffix}`;
}

export function displayName(firstName: string, lastInitial: string): string {
  return `${firstName} ${lastInitial}.`;
}

/** "Fri 2 Oct" in the given timezone. */
export function shortDate(date: Date, timeZone: string): string {
  return date.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone,
  });
}
