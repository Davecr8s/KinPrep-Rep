import type { RateLimit } from "@/config/security";

// Pure rules for the fixed-window rate limiter (src/lib/security/rate-limit.ts stores the counts).

/** The start of the window `now` falls in. Windows are aligned to the epoch, so all servers agree. */
export function windowStart(now: Date, windowSeconds: number): Date {
  const size = windowSeconds * 1000;
  return new Date(Math.floor(now.getTime() / size) * size);
}

export type RateDecision = { ok: true } | { ok: false; retryAfterSeconds: number };

/** Allowed if this request's count (including it) is within the limit. */
export function decide(hits: number, rule: RateLimit, now: Date): RateDecision {
  if (hits <= rule.limit) return { ok: true };
  const ends = windowStart(now, rule.windowSeconds).getTime() + rule.windowSeconds * 1000;
  return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((ends - now.getTime()) / 1000)) };
}

/**
 * The caller's IP address. On Vercel, x-forwarded-for's first entry is the client, set by
 * Vercel's edge (a client can't spoof it there); x-real-ip is the same. "unknown" otherwise,
 * so callers without an address share one bucket rather than escaping the limit.
 */
export function clientIp(headers: { get(name: string): string | null }): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || headers.get("x-real-ip")?.trim();
  return ip && ip.length <= 64 ? ip : "unknown";
}
