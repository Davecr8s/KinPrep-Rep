// Outbound messaging: sending limits, retries, cost estimates, report times and the job schedule.
// No imports: scripts read this file directly with Node.

/** Defaults for the admin settings that keep us inside Meta's sending limits. */
export const SENDING_LIMITS = {
  /** Settings key "wa_messages_per_second". Meta's Cloud API allows far more; stay gentle. */
  perSecond: 10,
  /** Settings key "wa_messages_per_day": business-started messages in any 24 hours. Meta starts
   *  new numbers at 250 unique people a day and raises the limit as quality stays high. */
  perDay: 250,
} as const;

/** Retries: wait this long after each failed attempt; after the last, the message is "failed". */
export const RETRY_BACKOFF_SECONDS = [30, 120, 600, 3_600, 21_600] as const;

export type MessageCategory = "utility" | "marketing" | "authentication";

/**
 * Estimated price per delivered template message in US dollars, by the recipient's country
 * calling code. Approximations of Meta's per-message rate card: check
 * developers.facebook.com/docs/whatsapp/pricing and update when it changes. Utility templates
 * sent while the person's 24-hour window is open are free.
 */
export const META_PRICE_USD: Record<string, Record<MessageCategory, number>> = {
  "234": { marketing: 0.0516, utility: 0.0067, authentication: 0.0067 }, // Nigeria
  "44": { marketing: 0.0529, utility: 0.022, authentication: 0.0358 }, // United Kingdom
  "353": { marketing: 0.0568, utility: 0.0232, authentication: 0.0384 }, // Ireland
  "1": { marketing: 0.025, utility: 0.004, authentication: 0.0135 }, // US and Canada
  other: { marketing: 0.0604, utility: 0.0077, authentication: 0.0224 },
};

/** Weekly report times a payer can choose, in their own timezone: Saturday evening to Sunday. */
export const REPORT_TIMES = {
  saturday: { weekday: 6, fromHour: 18, toHour: 23 },
  sunday: { weekday: 0, fromHour: 7, toHour: 21 },
} as const;

export type ScheduledJob =
  "morning" | "junior-links" | "reminder" | "missed-days" | "weekly-reports" | "worker";

/**
 * Vercel Cron schedule (UTC; Lagos is UTC+1 all year). Every entry runs at most once a day, so the
 * same file works on Vercel's Hobby plan (which also lets a job start up to 59 minutes late). Weekly
 * reports run hourly from Saturday 17:00 UTC to Monday 05:00 UTC: Saturday 18:00 in Lagos to
 * Sunday 21:00 on the US west coast. vercel.json is checked against this list by a test.
 */
export function cronSchedule(): { path: string; schedule: string }[] {
  const daily: [ScheduledJob, string][] = [
    ["morning", "0 6 * * *"], // 07:00 Lagos
    ["junior-links", "0 6 * * *"], // 07:00 Lagos
    ["worker", "30 7 * * *"], // retries
    ["reminder", "0 17 * * *"], // 18:00 Lagos
    ["missed-days", "0 20 * * *"], // 21:00 Lagos
  ];
  const weekly: string[] = [];
  for (let h = 17; h <= 23; h++) weekly.push(`0 ${h} * * 6`);
  for (let h = 0; h <= 23; h++) weekly.push(`0 ${h} * * 0`);
  for (let h = 0; h <= 5; h++) weekly.push(`0 ${h} * * 1`);
  return [
    ...daily.map(([job, schedule]) => ({ path: `/api/jobs/${job}`, schedule })),
    ...weekly.map((schedule) => ({ path: "/api/jobs/weekly-reports", schedule })),
  ];
}
