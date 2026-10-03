import "server-only";
import { appSql } from "@/lib/db/postgres";
import { parseEnvGroup, serverEnv, type Env, type EnvGroup } from "@/lib/env";
import { cloudTransport } from "@/lib/whatsapp/outbox";
import { resendTransport } from "./email";
import { runJob, type JobName, type JobReport } from "./jobs";
import { runQueue, type WorkerResult } from "./queue";

// Production wiring for the scheduled jobs: direct Postgres, Meta's Cloud API, Resend.

/** The group's variables, or null if it isn't set up yet (e.g. no Meta account yet). */
function optionalEnv<G extends EnvGroup>(group: G): Env<G> | null {
  try {
    return parseEnvGroup(group, process.env);
  } catch {
    return null;
  }
}

export function sendQueued(): Promise<WorkerResult> {
  const whatsapp = optionalEnv("whatsapp");
  const email = optionalEnv("email");
  return runQueue({
    sql: appSql(),
    whatsapp: whatsapp
      ? cloudTransport({
          accessToken: whatsapp.WHATSAPP_ACCESS_TOKEN,
          phoneNumberId: whatsapp.WHATSAPP_PHONE_NUMBER_ID,
          graphVersion: whatsapp.WHATSAPP_GRAPH_VERSION,
        })
      : null,
    email: email ? resendTransport({ apiKey: email.RESEND_API_KEY, from: email.EMAIL_FROM }) : null,
  });
}

/** Runs a job; unless it's a dry run, sends what it queued (and anything waiting) straight away. */
export async function runScheduledJob(
  job: JobName,
  options: { dryRun: boolean; now: Date },
): Promise<{ report: JobReport; worker: WorkerResult | null }> {
  const report = await runJob(job, {
    sql: appSql(),
    now: options.now,
    dryRun: options.dryRun,
    appUrl: serverEnv("app").NEXT_PUBLIC_APP_URL,
    practiceSecret: serverEnv("practice").PRACTICE_LINK_SECRET,
  });
  return { report, worker: options.dryRun ? null : await sendQueued() };
}
