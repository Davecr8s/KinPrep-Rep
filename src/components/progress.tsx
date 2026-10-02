import { STREAK_DAY_THRESHOLD } from "@/config/pilot";
import { SUBJECT_LABELS } from "@/lib/labels";
import type { SessionSummary, TopicAccuracy, WeekDot } from "@/lib/rules/progress";

// Server-rendered progress pieces for the dashboard and report pages.

const DAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"];

export function WeekDots({ dots }: { dots: WeekDot[] }) {
  const done = dots.filter((d) => d.practised).length;
  return (
    <div>
      <ol
        className="flex justify-between gap-1"
        aria-label={`Practised ${done} of 7 days this week`}
      >
        {dots.map((d, i) => {
          const name = new Date(`${d.day}T12:00:00Z`).toLocaleDateString("en-GB", {
            weekday: "long",
            timeZone: "UTC",
          });
          const state = d.practised
            ? "practised"
            : d.future
              ? "still to come"
              : d.today
                ? "not yet today"
                : "missed";
          return (
            <li
              key={d.day}
              className="flex flex-col items-center gap-1"
              aria-label={`${name}: ${state}`}
            >
              <span
                className={`size-9 rounded-full border-2 ${
                  d.practised
                    ? "border-orange bg-orange"
                    : d.future
                      ? "border-dashed border-navy/20"
                      : "border-navy/30 bg-white"
                } ${d.today ? "ring-2 ring-navy ring-offset-2" : ""}`}
              />
              <span
                className={`text-xs ${d.today ? "font-bold text-navy-dark" : "text-navy-dark/60"}`}
              >
                {DAY_LETTERS[i]}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="mt-2 text-sm text-navy-dark/70">
        A dot fills in at {STREAK_DAY_THRESHOLD} questions in a day (Lagos time).
      </p>
    </div>
  );
}

export function Stat({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="rounded-xl bg-navy/5 px-3 py-3 text-center">
      <p className="text-2xl font-bold text-navy-dark">{value}</p>
      <p className="text-sm text-navy-dark/70">{label}</p>
    </div>
  );
}

export function WeakTopics({ topics }: { topics: TopicAccuracy[] }) {
  if (topics.length === 0) {
    return <p className="text-navy-dark/70">Not enough answers yet to spot weak topics.</p>;
  }
  return (
    <ol className="flex flex-col gap-2">
      {topics.map((t) => (
        <li key={`${t.subject}-${t.topic}`} className="flex items-center justify-between gap-3">
          <span>
            <span className="block font-semibold">{t.topic}</span>
            <span className="text-sm text-navy-dark/70">
              {SUBJECT_LABELS[t.subject]} · {t.attempts} tries
            </span>
          </span>
          <span className="shrink-0 font-bold text-navy-dark">{t.accuracy}%</span>
        </li>
      ))}
    </ol>
  );
}

export function SessionList({
  sessions,
  timeZone,
}: {
  sessions: SessionSummary[];
  timeZone: string;
}) {
  if (sessions.length === 0) return <p className="text-navy-dark/70">No practice sessions yet.</p>;
  return (
    <ul className="divide-y divide-navy/10">
      {sessions.map((s) => (
        <li key={s.sessionId} className="flex items-center justify-between gap-3 py-2">
          <span>
            <span className="block font-semibold">
              {s.startedAt.toLocaleDateString("en-GB", {
                weekday: "short",
                day: "numeric",
                month: "short",
                timeZone,
              })}
              <span className="font-normal text-navy-dark/60">
                {" "}
                {s.startedAt.toLocaleTimeString("en-GB", {
                  hour: "2-digit",
                  minute: "2-digit",
                  timeZone,
                })}
              </span>
            </span>
            <span className="text-sm text-navy-dark/70">
              {s.subjects.map((x) => SUBJECT_LABELS[x]).join(", ")}
            </span>
          </span>
          <span className="shrink-0 text-right">
            <span className="block font-bold text-navy-dark">
              {s.correct}/{s.answered}
            </span>
            <span className="text-sm text-navy-dark/70">correct</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
