import "server-only";
import { headers } from "next/headers";
import type { RateLimitBucket } from "@/config/security";
import { appSql } from "@/lib/db/postgres";
import { reportError } from "@/lib/monitoring/report";
import { clientIp, createRateLimiter, tooManyRequests, type RateLimiter } from "./rate-limit";

let limiter: RateLimiter | undefined;

function rateLimiter(): RateLimiter {
  // The HMAC key only has to be secret, not shared with anything: RATE_LIMIT_SECRET if set,
  // otherwise the cron secret (both server-only).
  const secret = process.env.RATE_LIMIT_SECRET || process.env.CRON_SECRET || "kinprep-dev-only";
  limiter ??= createRateLimiter({
    sql: appSql,
    secret,
    onError: (error) => void reportError({ where: "rate-limit", error, level: "warning" }),
  });
  return limiter;
}

/** For route handlers: a 429 response if this caller is over the limit, otherwise null. */
export async function limitRequest(
  request: Request,
  bucket: RateLimitBucket,
): Promise<Response | null> {
  const decision = await rateLimiter()(bucket, clientIp(request.headers));
  return decision.ok ? null : tooManyRequests(decision);
}

/**
 * For server actions and pages: true if this caller (by IP, or by `identity` such as an email)
 * is within the limit.
 */
export async function withinLimit(bucket: RateLimitBucket, identity?: string): Promise<boolean> {
  const who = identity ?? clientIp(await headers());
  return (await rateLimiter()(bucket, who)).ok;
}
