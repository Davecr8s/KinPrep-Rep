import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

// The launch "Done when", end to end on a phone-sized screen, against real test services:
//   a sponsor signs up, adds a child, pays in Stripe test mode, the child completes a day in the
//   WhatsApp simulator, and the weekly report is generated.
// Runs against a Vercel preview (E2E_BASE_URL; .github/workflows/preview.yml) or locally against
// `npm run dev` with `stripe listen` forwarding to /api/webhooks/stripe. Needs:
//   E2E_FULL=1, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY (the same test project the site
//   uses), STRIPE_SECRET_KEY (sk_test_...: refuses to run against live keys), CRON_SECRET,
//   and approved questions in the database (npm run seed:dev).
// See docs/LAUNCH.md, "Preview end-to-end test".

const ready =
  process.env.E2E_FULL === "1" &&
  !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !!process.env.SUPABASE_SECRET_KEY &&
  !!process.env.CRON_SECRET &&
  process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_");

test.skip(!ready, "Needs E2E_FULL=1, a test Supabase project, Stripe test keys and CRON_SECRET");
test.setTimeout(300_000);

const admin = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

/** Signs in through the real magic-link route, with a link made by the Supabase admin API. */
async function signInAs(page: Page, email: string, next: string): Promise<string> {
  const db = admin();
  const { data: created } = await db.auth.admin.createUser({ email, email_confirm: true });
  const { data, error } = await db.auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw error;
  await page.goto(
    `/auth/confirm?token_hash=${data.properties.hashed_token}&type=magiclink&next=${encodeURIComponent(next)}`,
  );
  return created.user?.id ?? data.user.id;
}

/** The UTC moment that is Sunday 20:00 in `timeZone`, in the current (Monday-Sunday) week there. */
function thisSundayEvening(timeZone: string, now = new Date()): Date {
  const parts = (d: Date) =>
    Object.fromEntries(
      new Intl.DateTimeFormat("en-GB", {
        timeZone,
        weekday: "short",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        hourCycle: "h23",
      })
        .formatToParts(d)
        .map((p) => [p.type, p.value]),
    );
  // Walk forward hour by hour from today's local midnight-ish until Sunday 20:00 local.
  const start = new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000 - 24 * 3_600_000);
  const today = parts(now);
  const todayKey = `${today.year}-${today.month}-${today.day}`;
  let passedToday = false;
  for (let h = 0; h < 10 * 24; h++) {
    const t = new Date(start.getTime() + h * 3_600_000);
    const p = parts(t);
    if (`${p.year}-${p.month}-${p.day}` === todayKey) passedToday = true;
    if (passedToday && p.weekday === "Sun" && p.hour === "20") return t;
  }
  throw new Error("no Sunday found");
}

test("sponsor signs up, adds a child, pays by Stripe test card; the child practises; the report is made", async ({
  page,
  browser,
  request,
}) => {
  const db = admin();
  const { count } = await db
    .from("questions")
    .select("id", { count: "exact", head: true })
    .eq("status", "approved");
  expect(count ?? 0, "seed approved questions first (npm run seed:dev)").toBeGreaterThan(10);

  // 1. Sign up as a new sponsor abroad.
  const stamp = Date.now();
  const email = `e2e-launch-${stamp}@kinprep.test`;
  const sponsorId = await signInAs(page, email, "/app/onboarding?region=abroad");
  await page.getByLabel(/I live abroad/).check();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/app\/children\/new/);

  // 2. Add a senior child (16), who gets daily questions on WhatsApp; the sponsor is the guardian.
  const year = new Date().getUTCFullYear();
  const phone = `+23480${String(stamp).slice(-8)}`;
  await page.getByLabel("First name").fill("Ada");
  await page.getByLabel("Surname initial").fill("O");
  await page.getByLabel("Class").selectOption("SS2");
  await page.getByLabel("Birth year").fill(String(year - 16));
  await page.getByLabel("Exam", { exact: true }).selectOption("WASSCE");
  await page.getByLabel("Child's WhatsApp number").fill(`0${phone.slice(4)}`);
  await page.getByLabel("Yes", { exact: true }).check();
  await page.getByLabel(/I agree, as this child's parent/).check();
  await page.getByRole("button", { name: "Add child" }).click();
  await expect(page.getByRole("heading", { name: "Plan for Ada" })).toBeVisible();

  // 3. Pay in Stripe test mode on Stripe's hosted Checkout page.
  await page.getByRole("button", { name: /Start free trial|Continue to payment/ }).click();
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 60_000 });
  await page.locator("#cardNumber").fill("4242 4242 4242 4242");
  await page.locator("#cardExpiry").fill("12 / 34");
  await page.locator("#cardCvc").fill("123");
  await page.locator("#billingName").fill("E2E Sponsor");
  const postcode = page.locator("#billingPostalCode");
  if (await postcode.isVisible()) await postcode.fill("SW1A 1AA");
  await page.locator('[data-testid="hosted-payment-submit-button"]').click();
  await page.waitForURL(/\/app\/children\/[0-9a-f-]+\?paid=1/, { timeout: 90_000 });
  const childUrl = page.url().split("?")[0]!;
  // Stripe's webhook reaches the site and activates the plan.
  await expect(async () => {
    await page.reload();
    await expect(page.getByText(/Active until|Free trial until/)).toBeVisible();
  }).toPass({ timeout: 60_000 });

  // 4. The child completes today's set in the WhatsApp simulator (run by a test admin).
  const adminEmail = `e2e-admin-${stamp}@kinprep.test`;
  const adminContext = await browser.newContext({ ...test.info().project.use });
  const sim = await adminContext.newPage();
  const adminId = await signInAs(sim, adminEmail, "/app");
  await db.from("profiles").upsert({ id: adminId, role: "admin" });
  await sim.goto(`/admin/dev/whatsapp?phone=${encodeURIComponent(phone)}`);
  await sim.getByRole("button", { name: "START", exact: true }).click();
  const chat = sim.locator('section[aria-label^="Chat with"]');
  const finished = chat.getByText(/finished today's set/);
  for (let step = 0; step < 80 && !(await finished.count()); step++) {
    const last = chat.locator(":scope > div").last();
    const list = last.locator("details");
    if (await list.count()) {
      await list.locator("summary").click();
      await list.locator("button").first().click();
    } else {
      const next = last.getByRole("button", { name: /Next question|See my score/ });
      const answer = last.getByRole("button").filter({ hasNotText: "Explain another way" });
      if (await next.count()) await next.click();
      else if (await answer.count()) await answer.first().click();
      else throw new Error(`Stuck at: ${await last.innerText()}`);
    }
    await sim.waitForURL(/phone=/);
  }
  await expect(finished).toBeVisible();
  await adminContext.close();

  // The sponsor sees the day on the child's dashboard.
  await page.goto(childUrl);
  await expect(page.getByLabel(/Practised [1-7] of 7 days this week/)).toBeVisible();

  // 5. The weekly report is generated: the scheduled job, as Vercel Cron calls it, in a dry run
  //    at the sponsor's Sunday evening (nothing is sent).
  const { data: payer } = await db.from("payers").select("timezone").eq("id", sponsorId).single();
  const at = thisSundayEvening(payer!.timezone as string);
  const res = await request.get(
    `/api/jobs/weekly-reports?dryRun=1&at=${encodeURIComponent(at.toISOString())}`,
    { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } },
  );
  expect(res.status()).toBe(200);
  const report = (await res.json()) as {
    planned: { to: string; about: string; preview: string; channel: string }[];
  };
  const mine = report.planned.find((p) => p.to === email);
  expect(mine, JSON.stringify(report.planned.slice(0, 5))).toBeDefined();
  expect(mine!.about).toContain("Ada");
  expect(mine!.preview).toMatch(/Practised on [1-7] of 7 days/);
});
