import { timingSafeEqual } from "node:crypto";
import { serverEnv } from "@/lib/env";
import { formatReport, JOBS, type JobName } from "@/lib/jobs/jobs";
import { runScheduledJob, sendQueued } from "@/lib/jobs/server";

export const maxDuration = 300;

// Scheduled jobs, called by Vercel Cron (vercel.json, from src/config/messaging.ts) with
// "Authorization: Bearer <CRON_SECRET>". Safe to call twice: each message has a dedupe key.
//   /api/jobs/morning | junior-links | reminder | missed-days | weekly-reports | worker
//   ?dryRun=1                  work out who would get what; record it as a dry run; send nothing
//   ?dryRun=1&at=<ISO time>    the same, as if it were that time (e.g. a Sunday for reports)
// npm run jobs -- <job> --dry-run calls this from the command line.

function authorised(request: Request): boolean {
  const expected = `Bearer ${serverEnv("cron").CRON_SECRET}`;
  const given = request.headers.get("authorization") ?? "";
  return (
    given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected))
  );
}

export async function GET(request: Request, ctx: RouteContext<"/api/jobs/[job]">) {
  if (!authorised(request)) return new Response("Unauthorized", { status: 401 });
  const { job } = await ctx.params;
  if (job === "worker") return Response.json({ job, worker: await sendQueued() });
  if (!(JOBS as readonly string[]).includes(job)) {
    return Response.json(
      { error: `Unknown job. Use one of: ${JOBS.join(", ")}, worker` },
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
