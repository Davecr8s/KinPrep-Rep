import { serverEnv } from "@/lib/env";
import { formatReport, JOBS, type JobName } from "@/lib/jobs/jobs";
import { runScheduledJob, sendQueued } from "@/lib/jobs/server";
import { appSql } from "@/lib/db/postgres";
import { purgeExpired } from "@/lib/privacy/retention";
import { hasBearer } from "@/lib/security/cron-auth";

export const maxDuration = 300;

// Scheduled jobs, called by Vercel Cron (vercel.json, from src/config/messaging.ts) with
// "Authorization: Bearer <CRON_SECRET>". Safe to call twice: each message has a dedupe key.
//   /api/jobs/morning | junior-links | reminder | missed-days | weekly-reports | worker | maintenance
//   ?dryRun=1                  work out who would get what; record it as a dry run; send nothing
//   ?dryRun=1&at=<ISO time>    the same, as if it were that time (e.g. a Sunday for reports)
// npm run jobs -- <job> --dry-run calls this from the command line.

function authorised(request: Request): boolean {
  return hasBearer(request, serverEnv("cron").CRON_SECRET);
}

export async function GET(request: Request, ctx: RouteContext<"/api/jobs/[job]">) {
  if (!authorised(request)) return new Response("Unauthorized", { status: 401 });
  const { job } = await ctx.params;
  if (job === "worker") return Response.json({ job, worker: await sendQueued() });
  if (job === "maintenance") {
    return Response.json({ job, deleted: await purgeExpired(appSql(), new Date()) });
  }
  if (!(JOBS as readonly string[]).includes(job)) {
    return Response.json(
      { error: `Unknown job. Use one of: ${JOBS.join(", ")}, worker, maintenance` },
      { status: 404 },
    );
  }
  const url = new URL(request.url);
  const dryRun = ["1", "true"].includes(url.searchParams.get("dryRun") ?? "");
  const at = url.searchParams.get("at");
  if (at && !dryRun) {
    return Response.json({ error: "'at' is only allowed with dryRun=1" }, { status: 400 });
  }
  const now = at ? new Date(at) : new Date();
  if (Number.isNaN(now.getTime())) {
    return Response.json({ error: "'at' must be an ISO date-time" }, { status: 400 });
  }
  const { report, worker } = await runScheduledJob(job as JobName, { dryRun, now });
  return Response.json({ ...report, worker, text: formatReport(report) });
}
