import { randomUUID } from "node:crypto";
import { parseDsn, scrub, sentryRequest, type ErrorReport } from "./sentry";

// The one place server errors are reported: always to the logs (Vercel > Logs), and to Sentry
// when SENTRY_DSN is set. Never throws; a failing report must not break the request.

export async function reportError(
  report: ErrorReport,
  deps: { fetch?: typeof fetch; env?: Record<string, string | undefined>; now?: Date } = {},
): Promise<void> {
  const env = deps.env ?? process.env;
  const message = report.error instanceof Error ? report.error.message : String(report.error);
  console.error(`[${report.where}] ${scrub(message)}`);
  const dsn = env.SENTRY_DSN ? parseDsn(env.SENTRY_DSN) : null;
  if (!dsn) return;
  const request = sentryRequest(dsn, report, {
    eventId: randomUUID().replace(/-/g, ""),
    now: deps.now ?? new Date(),
    environment: env.SENTRY_ENVIRONMENT || env.VERCEL_ENV || "development",
    release: env.VERCEL_GIT_COMMIT_SHA,
  });
  try {
    const res = await (deps.fetch ?? fetch)(request.url, {
      method: "POST",
      headers: request.headers,
      body: request.body,
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) console.error(`[monitoring] Sentry answered ${res.status}`);
  } catch (error) {
    console.error("[monitoring] could not reach Sentry", String(error));
  }
}
