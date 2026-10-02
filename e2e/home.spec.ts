import { expect, test } from "@playwright/test";

test("home page shows the KinPrep name and tagline", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/KinPrep/);
  await expect(page.getByRole("heading", { level: 1, name: "KinPrep" })).toBeVisible();
  await expect(
    page.getByText("They practise daily. You see the proof every Sunday."),
  ).toBeVisible();
});
