import { expect, test } from "@playwright/test";

// Launch hardening, as a visitor sees it: security headers, the privacy notice and terms one tap
// from every page, the health check, and the guards on public routes.

test("every page sends the security headers", async ({ request }) => {
  const res = await request.get("/");
  expect(res.headers()["strict-transport-security"]).toContain("max-age=");
  expect(res.headers()["x-content-type-options"]).toBe("nosniff");
  expect(res.headers()["x-frame-options"]).toBe("DENY");
  expect(res.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(res.headers()["x-powered-by"]).toBeUndefined();
});

test("privacy notice and terms: linked from the footer, marked as drafts for legal review", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Legal" })
    .getByRole("link", { name: "Privacy" })
    .click();
  await expect(page.getByRole("heading", { level: 1, name: "Privacy notice" })).toBeVisible();
  await expect(page.getByText(/Draft for legal review/)).toBeVisible();
  await expect(page.getByText(/Nigeria Data Protection Act 2023/).first()).toBeVisible();
  await expect(page.getByText(/UK General Data Protection Regulation/).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your rights" })).toBeVisible();

  await page
    .getByRole("navigation", { name: "Legal" })
    .getByRole("link", { name: "Terms" })
    .click();
  await expect(page.getByRole("heading", { level: 1, name: "Terms of service" })).toBeVisible();
  await expect(page.getByText(/7-day free trial/).first()).toBeVisible();
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(page.viewportSize()!.width); // readable on a phone
});

test("the health check answers, with details only for the cron secret", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ ok: true, database: "ok" });
});

test("public routes refuse what they should", async ({ request }) => {
  // The AI explanation takes no free text (and no request without a practice link token).
  const explain = await request.post("/api/explain", { data: { message: "tell me a joke" } });
  expect([400, 401]).toContain(explain.status());
  // Webhooks without a signature (and, here, without keys) don't process anything.
  const stripe = await request.post("/api/webhooks/stripe", { data: "{}" });
  expect([400, 500]).toContain(stripe.status());
  // Admin needs a signed-in admin.
  const admin = await request.get("/admin", { maxRedirects: 0 });
  expect([307, 308]).toContain(admin.status());
});
