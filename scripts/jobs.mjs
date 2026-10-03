// Runs a scheduled job on a running KinPrep site (local `npm run dev` or Vercel), the same way
// Vercel Cron does, and prints who got (or would get) what.
//
// Usage:
//   npm run jobs -- morning --dry-run
//   npm run jobs -- weekly-reports --dry-run --at 2026-10-11T18:00:00+01:00
//   npm run jobs -- reminder                     (for real: sends)
//   npm run jobs -- worker                       (send anything waiting in the queue)
// Jobs: morning, junior-links, reminder, missed-days, weekly-reports, worker.
// Reads CRON_SECRET and NEXT_PUBLIC_APP_URL from .env.local; --url overrides the site.

const args = process.argv.slice(2);
const job = args.find((a) => !a.startsWith("--"));
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : (args[i + 1] ?? "");
};
const dryRun = args.includes("--dry-run");
const at = flag("at");
const base = flag("url") || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const secret = process.env.CRON_SECRET;

if (!job) {
  console.error(
    "Which job? morning, junior-links, reminder, missed-days, weekly-reports or worker.",
  );
  process.exit(1);
}
if (!secret) {
  console.error("CRON_SECRET is not set in .env.local.");
  process.exit(1);
}

const url = new URL(`/api/jobs/${job}`, base);
if (dryRun) url.searchParams.set("dryRun", "1");
if (at) url.searchParams.set("at", at);

const response = await fetch(url, { headers: { Authorization: `Bearer ${secret}` } });
const body = await response.json().catch(() => null);
if (!response.ok || !body) {
  console.error(`${response.status} ${response.statusText}`, body ?? "");
  process.exit(1);
}
if (body.text) console.log(body.text);
if (body.worker) {
  const w = body.worker;
  console.log(
    `  worker: sent ${w.sent}, blocked ${w.blocked}, retrying ${w.retrying}, failed ${w.failed}, expired ${w.expired}, waiting ${w.waiting}`,
  );
}
