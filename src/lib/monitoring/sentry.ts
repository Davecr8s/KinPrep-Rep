// Error reports to Sentry (sentry.io) over its plain HTTP envelope API, without the SDK: one
// small fetch, nothing in the browser bundle, and we control exactly what leaves the server.
// Nothing personal is sent: messages and paths are scrubbed of emails, phone numbers and tokens,
// and request bodies, headers and query strings are never included (NDPA 2023, UK GDPR).

export type ErrorReport = {
  /** Where it happened, e.g. "webhook:stripe", "job:morning", "route:/api/explain". */
  where: string;
  error: unknown;
  method?: string;
  path?: string;
  tags?: Record<string, string>;
  level?: "error" | "warning";
};

/** Removes emails, phone numbers and long tokens from text that might contain them. */
export function scrub(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[email]")
    .replace(/\+?\d[\d\s-]{8,}\d/g, "[phone]")
    .replace(/[A-Za-z0-9_-]{24,}/g, "[token]");
}

/** A path with no query string, and every token-like segment replaced (/p/<token> → /p/:id). */
export function scrubPath(path: string): string {
  const bare = path.split(/[?#]/)[0] ?? "";
  return bare
    .split("/")
    .map((seg) => (/^[A-Za-z0-9_-]{12,}$/.test(seg) || /\d{4,}/.test(seg) ? ":id" : seg))
    .join("/");
}

export type ParsedDsn = { key: string; host: string; projectId: string; protocol: string };

/** https://<key>@<host>/<project id>, as shown in Sentry > Project settings > Client keys. */
export function parseDsn(dsn: string): ParsedDsn | null {
  try {
    const url = new URL(dsn);
    const projectId = url.pathname.replace(/^\/+/, "");
    if (!url.username || !/^\d+$/.test(projectId)) return null;
    return { key: url.username, host: url.host, projectId, protocol: url.protocol };
  } catch {
    return null;
  }
}

function describe(error: unknown): { type: string; value: string; stack?: string } {
  if (error instanceof Error) {
    const digest = "digest" in error ? ` (digest ${String(error.digest)})` : "";
    return { type: error.name, value: `${error.message}${digest}`, stack: error.stack };
  }
  return { type: "Error", value: String(error) };
}

/** The HTTP request that sends one report to Sentry. */
export function sentryRequest(
  dsn: ParsedDsn,
  report: ErrorReport,
  context: { eventId: string; now: Date; environment: string; release?: string },
): { url: string; headers: Record<string, string>; body: string } {
  const { type, value, stack } = describe(report.error);
  const event = {
    event_id: context.eventId,
    timestamp: context.now.getTime() / 1000,
    platform: "node",
    level: report.level ?? "error",
    environment: context.environment,
    ...(context.release ? { release: context.release } : {}),
    transaction: report.where,
    tags: {
      where: report.where,
      ...(report.method ? { method: report.method } : {}),
      ...report.tags,
    },
    ...(report.path ? { request: { method: report.method, url: scrubPath(report.path) } } : {}),
    exception: { values: [{ type, value: scrub(value) }] },
    ...(stack ? { extra: { stack: scrub(stack).slice(0, 8000) } } : {}),
  };
  const header = { event_id: context.eventId, sent_at: context.now.toISOString() };
  return {
    url: `${dsn.protocol}//${dsn.host}/api/${dsn.projectId}/envelope/`,
    headers: {
      "content-type": "application/x-sentry-envelope",
      "x-sentry-auth": `Sentry sentry_version=7, sentry_key=${dsn.key}, sentry_client=kinprep/1.0`,
    },
    body: [JSON.stringify(header), JSON.stringify({ type: "event" }), JSON.stringify(event)].join(
      "\n",
    ),
  };
}
