import "server-only";
import { appSql } from "@/lib/db/postgres";
import { serverEnv } from "@/lib/env";
import { practiceUrl, signPracticeLink } from "./links";
import type { WebDeps } from "./web";

// Production wiring for web practice: direct Postgres (same as the bot) and the link secret.

export function webDeps(now: Date = new Date()): WebDeps {
  return {
    sql: appSql(),
    secret: serverEnv("practice").PRACTICE_LINK_SECRET,
    appUrl: serverEnv("app").NEXT_PUBLIC_APP_URL,
    now,
  };
}

/** A fresh link to the student's set for today, valid for 24 hours. */
export function todayPracticeUrl(studentId: string, now: Date = new Date()): string {
  const token = signPracticeLink(
    { studentId, issuedAt: now },
    serverEnv("practice").PRACTICE_LINK_SECRET,
  );
  return practiceUrl(serverEnv("app").NEXT_PUBLIC_APP_URL, token);
}
