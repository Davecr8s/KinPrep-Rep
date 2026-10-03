import { createHmac } from "node:crypto";
import { RATE_LIMITS, type RateLimitBucket } from "@/config/security";
import type { Sql } from "@/lib/db/sql";
import { clientIp, decide, windowStart, type RateDecision } from "@/lib/rules/rate-limit";

// Fixed-window rate limits for public routes, counted in Postgres (public.rate_limits) so every
// serverless instance shares them. Callers are identified by an HMAC of their IP address or
// email, never the raw value. If the database can't be reached the request is allowed (and the
// error reported): an outage of the counter must not take sign-in or payments down with it.

export type RateLimiter = (
  bucket: RateLimitBucket,
  identity: string,
  now?: Date,
) => Promise<RateDecision>;

export function createRateLimiter(deps: {
  sql: () => Sql;
  secret: string;
  onError?: (error: unknown) => void;
}): RateLimiter {
  return async (bucket, identity, now = new Date()) => {
    const rule = RATE_LIMITS[bucket];
    const key = createHmac("sha256", deps.secret)
      .update(`${bucket}:${identity.toLowerCase()}`)
      .digest("base64url");
    try {
      const [row] = await deps
        .sql()
        .query<{ hits: number }>("select public.rate_limit_hit($1, $2, $3) as hits", [
          bucket,
          key,
          windowStart(now, rule.windowSeconds),
        ]);
      return decide(row!.hits, rule, now);
    } catch (error) {
      deps.onError?.(error);
      return { ok: true };
    }
  };
}

/** The response for a refused request: 429 with Retry-After, which providers and browsers honour. */
export function tooManyRequests(decision: Extract<RateDecision, { ok: false }>): Response {
  return new Response("Too many requests. Please wait a few minutes and try again.", {
    status: 429,
    headers: {
      "retry-after": String(decision.retryAfterSeconds),
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
    },
  });
}

export { clientIp };
