import { expect, test } from "@playwright/test";

test("landing page: tagline, prices by region, trial button and FAQ", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/KinPrep/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "They practise daily. You see the proof every Sunday.",
  );

  // Outside Nigeria (no geo header locally): pounds by default, naira on request.
  await expect(page.getByText("£6", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "I live in Nigeria" }).click();
  await expect(page.getByText("₦500", { exact: true })).toBeVisible();
  await expect(page.getByText("₦2,000", { exact: true })).toBeVisible();

  const trial = page.getByRole("link", { name: /7-day free trial/ });
  await expect(trial).toHaveAttribute("href", "/app/sign-in?region=nigeria");

  await page.getByText("Can I cancel any time?").click();
  await expect(page.getByText(/Cancel from your settings/)).toBeVisible();
});

test("installable: manifest with KinPrep colours and PNG icons", async ({ request }) => {
  const manifest = await (await request.get("/manifest.webmanifest")).json();
  expect(manifest).toMatchObject({
    name: "KinPrep",
    theme_color: "#25308A",
    display: "standalone",
    start_url: "/app",
  });
  for (const icon of manifest.icons as { src: string }[]) {
    const response = await request.get(icon.src);
    expect(response.headers()["content-type"]).toBe("image/png");
  }
});

test("sign-in page asks for an email", async ({ page }) => {
  await page.goto("/app/sign-in?region=abroad");
  await expect(page.getByRole("heading", { name: "Sign in or sign up" })).toBeVisible();
  await expect(page.getByLabel("Email address")).toBeVisible();
});
