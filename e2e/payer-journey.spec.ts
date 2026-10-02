import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

// The Phase 3 "Done when", end to end on a phone-sized screen:
// a new sponsor signs up, adds a senior and a junior, pays in Stripe test mode, and sees seeded
// progress. Needs real services, so it is skipped unless these are set (e.g. from .env.local):
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
//   STRIPE_SECRET_KEY (sk_test_...), STRIPE_WEBHOOK_SECRET
// and `stripe listen --forward-to localhost:3000/api/webhooks/stripe` is running.
// Run: npx playwright test e2e/payer-journey.spec.ts  (with E2E_FULL=1)

const ready =
  process.env.E2E_FULL === "1" &&
  !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !!process.env.SUPABASE_SECRET_KEY &&
  process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_");

test.skip(!ready, "Needs E2E_FULL=1, Supabase and Stripe test keys, and stripe listen");
test.setTimeout(180_000);

const admin = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

async function signInAs(page: Page, email: string, next: string) {
  const db = admin();
  await db.auth.admin.createUser({ email, email_confirm: true });
  const { data, error } = await db.auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw error;
  const hash = data.properties.hashed_token;
  await page.goto(
    `/auth/confirm?token_hash=${hash}&type=magiclink&next=${encodeURIComponent(next)}`,
  );
}

async function fillChild(
  page: Page,
  child: { name: string; initial: string; klass: string; year: string; exam: string },
) {
  await page.getByLabel("First name").fill(child.name);
  await page.getByLabel("Surname initial").fill(child.initial);
  await page.getByLabel("Class").selectOption(child.klass);
  await page.getByLabel("Birth year").fill(child.year);
  await page.getByLabel("Exam", { exact: true }).selectOption(child.exam);
}

test("new sponsor: sign up, add senior and junior, pay with Stripe test card, see progress", async ({
  page,
}) => {
  const email = `e2e-${Date.now()}@kinprep.test`;
  const year = new Date().getUTCFullYear();
  await signInAs(page, email, "/app/onboarding?region=abroad");

  // Onboarding.
  await page.getByLabel(/I live abroad/).check();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/app\/children\/new/);

  // Senior child, payer is the guardian.
  await fillChild(page, {
    name: "Ada",
    initial: "O",
    klass: "SS2",
    year: String(year - 16),
    exam: "WASSCE",
  });
  await page.getByLabel("Child's WhatsApp number").fill(`080${String(Date.now()).slice(-8)}`);
  await page.getByLabel("Yes", { exact: true }).check();
  await page.getByLabel(/I agree, as this child's parent/).check();
  await page.getByRole("button", { name: "Add child" }).click();
  await expect(page.getByRole("heading", { name: "Plan for Ada" })).toBeVisible();

  // Pay in Stripe test mode (hosted Checkout page).
  await page.getByRole("button", { name: /Start free trial|Continue to payment/ }).click();
  await page.waitForURL(/checkout\.stripe\.com/);
  await page.locator("#cardNumber").fill("4242 4242 4242 4242");
  await page.locator("#cardExpiry").fill("12 / 34");
  await page.locator("#cardCvc").fill("123");
  await page.locator("#billingName").fill("E2E Sponsor");
  const postcode = page.locator("#billingPostalCode");
  if (await postcode.isVisible()) await postcode.fill("SW1A 1AA");
  await page.locator('[data-testid="hosted-payment-submit-button"]').click();
  await page.waitForURL(/\/app\/children\/[0-9a-f-]+\?paid=1/, { timeout: 60_000 });
  const seniorUrl = page.url().split("?")[0]!;
  // The webhook (via stripe listen) activates the trial.
  await expect(async () => {
    await page.reload();
    await expect(page.getByText(/Active until|Free trial until/)).toBeVisible();
  }).toPass({ timeout: 45_000 });

  // Junior child, payer is NOT the guardian: consent link, child stays inactive until accepted.
  await page.goto("/app/children/new");
  await fillChild(page, {
    name: "Bisi",
    initial: "O",
    klass: "JSS1",
    year: String(year - 11),
    exam: "BECE",
  });
  await expect(page.getByText("Junior mode (under 13)")).toBeVisible();
  await expect(page.getByLabel("Child's WhatsApp number")).toHaveCount(0);
  await page.getByLabel(/No, I'm a relative/).check();
  await page.getByRole("button", { name: "Add child" }).click();
  const link = await page.getByLabel("Consent link").inputValue();
  const guardian = await page.context().newPage();
  await guardian.goto(link);
  await guardian.getByLabel(/parent or legal guardian and I agree/).check();
  await guardian.getByRole("button", { name: "I agree" }).click();
  await expect(guardian.getByRole("heading", { name: "Thank you" })).toBeVisible();

  // Seeded progress for this sponsor's children, then the dashboard on a phone.
  execFileSync("node", ["--env-file=.env.local", "scripts/seed-progress.ts", "--email", email], {
    stdio: "inherit",
  });
  await page.goto(seniorUrl);
  await expect(page.getByRole("heading", { name: "Ada O." })).toBeVisible();
  await expect(page.getByLabel(/Practised \d of 7 days this week/)).toBeVisible();
  await expect(page.getByText("day streak")).toBeVisible();
  await expect(page.getByRole("img", { name: /Accuracy, last 8 weeks/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Topics to work on" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Last 10 sessions" })).toBeVisible();
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(page.viewportSize()!.width); // no sideways scrolling
});
