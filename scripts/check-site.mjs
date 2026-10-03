// Checks a deployed KinPrep site from the outside: the uptime check (every 15 minutes, from
// .github/workflows/uptime.yml) and the smoke test after each preview deploy (preview.yml).
//
//   node scripts/check-site.mjs --url https://kinprep-rep.vercel.app --uptime
//   node scripts/check-site.mjs --url https://<preview>.vercel.app --smoke
//
// Options (or environment variables):
//   --require stripe,paystack,whatsapp   webhook routes that must be configured (UPTIME_REQUIRE)
//   CRON_SECRET                          adds the detailed health check (webhook backlogs)
//   VERCEL_AUTOMATION_BYPASS_SECRET      gets past Vercel's preview protection
// Exits 1 with a list of what failed.

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : (args[i + 1] ?? "");
};
const base = (flag("url") || process.env.SITE_URL || "").replace(/\/$/, "");
const mode = args.includes("--smoke") ? "smoke" : "uptime";
const required = (flag("require") ?? process.env.UPTIME_REQUIRE ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const cronSecret = process.env.CRON_SECRET;
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

if (!base) {
  console.error("Which site? --url https://...");
  process.exit(2);
}

const failures = [];
const passes = [];

async function get(path, init = {}) {
  const headers = { "user-agent": "kinprep-check/1.0", ...(init.headers ?? {}) };
  if (bypass) headers["x-vercel-protection-bypass"] = bypass;
  const started = Date.now();
  try {
    const res = await fetch(`${base}${path}`, {
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
      ...init,
      headers,
    });
    return { res, ms: Date.now() - started };
  } catch (error) {
    return { res: null, ms: Date.now() - started, error: String(error) };
  }
}

async function check(name, path, expectFn, init) {
  const { res, ms, error } = await get(path, init);
  if (!res) {
    failures.push(`${name}: no response (${error})`);
    return;
  }
  const problem = await expectFn(res);
  if (problem) failures.push(`${name}: ${problem} (HTTP ${res.status}, ${ms} ms)`);
  else passes.push(`${name} (${ms} ms)`);
}

const status =
  (...codes) =>
  (res) =>
    codes.includes(res.status) ? null : `expected ${codes.join(" or ")}`;

// Both modes: the site and its database are up, and the webhook routes answer.
await check("health", "/api/health", async (res) => {
  if (res.status !== 200) return "site or database down";
  const body = await res.json().catch(() => null);
  return body?.database === "ok" ? null : "database not ok";
});
if (cronSecret) {
  await check(
    "health (detailed)",
    "/api/health",
    async (res) => {
      const body = await res.json().catch(() => null);
      if (!body) return "no JSON";
      return body.ok ? null : `problems: ${(body.problems ?? []).join("; ") || body.database}`;
    },
    { headers: { authorization: `Bearer ${cronSecret}` } },
  );
}
for (const provider of ["stripe", "paystack"]) {
  // 200 when configured; 503 means the route is up but its keys are missing.
  await check(
    `webhook route ${provider}`,
    `/api/webhooks/${provider}`,
    required.includes(provider) ? status(200) : status(200, 503),
  );
}
// Meta's verification GET without the token: 403 means the route is up and configured.
await check(
  "webhook route whatsapp",
  "/api/whatsapp",
  required.includes("whatsapp") ? status(403) : status(403, 500),
);

if (mode === "smoke") {
  await check("home page", "/", async (res) => {
    if (res.status !== 200) return "not 200";
    const missing = ["strict-transport-security", "x-content-type-options", "x-frame-options"]
      .filter((h) => !res.headers.get(h))
      .join(", ");
    if (missing) return `missing headers: ${missing}`;
    return (await res.text()).includes("KinPrep") ? null : "no KinPrep on the page";
  });
  await check("privacy notice", "/privacy", status(200));
  await check("terms", "/terms", status(200));
  await check("sign-in page", "/app/sign-in", status(200));
  await check("admin needs sign-in", "/admin", status(307, 308));
  await check("jobs need the cron secret", "/api/jobs/morning?dryRun=1", status(401));
  await check("a bad practice link is refused", "/p/not-a-real-token", status(404, 410));
  await check("explain refuses free text", "/api/explain", status(400, 401), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "tell me a joke" }),
  });
  await check("sponsor link with a bad code", "/sponsor/nope", status(404));
}

for (const p of passes) console.log(`ok   ${p}`);
for (const f of failures) console.error(`FAIL ${f}`);
console.log(`\n${base}: ${passes.length} passed, ${failures.length} failed (${mode}).`);
process.exit(failures.length ? 1 : 0);
