// Rate limits on public routes, and how long operational data is kept. Change them here only.

export type RateLimit = { limit: number; windowSeconds: number };

/**
 * Requests allowed per window, per caller (an HMAC of the IP address, or of the email for
 * sign-in). Many Nigerian phones share one IP (mobile carriers' NAT, school Wi-Fi), so limits on
 * routes students use are generous; the tight ones are where someone could spam or guess.
 */
export const RATE_LIMITS = {
  // Magic-link emails: per IP, and per email address (so one inbox can't be flooded).
  signInIp: { limit: 10, windowSeconds: 600 },
  signInEmail: { limit: 4, windowSeconds: 600 },
  // The 6-digit code: guessing is what this stops.
  signInCode: { limit: 10, windowSeconds: 600 },
  authConfirm: { limit: 30, windowSeconds: 600 },
  // Sponsor links (/sponsor/<code>): viewing, and starting a Stripe checkout.
  sponsorView: { limit: 60, windowSeconds: 600 },
  sponsorCheckout: { limit: 10, windowSeconds: 600 },
  // Class invite links (/join/<token>) and guardian consent links (/consent/<token>).
  joinGroup: { limit: 20, windowSeconds: 600 },
  consent: { limit: 20, windowSeconds: 600 },
  // The web practice page and "Explain another way" (shared IPs: generous).
  practice: { limit: 600, windowSeconds: 600 },
  explain: { limit: 120, windowSeconds: 600 },
  // Webhooks are signed, so this only stops floods; Stripe, Paystack and Meta retry a 429.
  webhook: { limit: 600, windowSeconds: 60 },
} as const satisfies Record<string, RateLimit>;

export type RateLimitBucket = keyof typeof RATE_LIMITS;

/**
 * Days operational data is kept before the daily maintenance job deletes it (minimal data:
 * NDPA 2023, UK GDPR). Answers, consents, payments and the audit log are kept while the account
 * exists; they go when the student is deleted (payments lose the link to the student).
 */
export const RETENTION_DAYS = {
  /** WhatsApp messages in and out (message_log): enough to answer a complaint about a message. */
  messageLog: 180,
  /** Inbound webhook jobs once processed (wa_jobs). */
  waJobs: 30,
  /** Sent, failed or expired items in the outbound queue (their log stays in message_log). */
  outboundQueue: 90,
  /** Dry runs of the scheduled jobs. */
  dryRuns: 14,
  /** Raw payment webhook payloads (billing_events), after processing. The ledger stays. */
  billingEvents: 400,
} as const;
