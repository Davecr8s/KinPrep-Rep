import { expect, test, type Page } from "@playwright/test";
import { signPracticeLink } from "../src/lib/practice/links";
import { E2E_PRACTICE_SECRET, E2E_STUDENTS } from "./support/fixtures";

// The web practice page on a phone-sized screen (Pixel 7), against a real Postgres schema
// (e2e/support/db-server.ts): a junior and a senior each complete a set, and answers survive a
// reload and a dropped connection. One database, so these run one after another.
test.describe.configure({ mode: "serial" });

const linkFor = (studentId: string) =>
  `/p/${signPracticeLink({ studentId, issuedAt: new Date() }, E2E_PRACTICE_SECRET)}`;

const shot = (page: Page, name: string) =>
  page.screenshot({ path: `test-results/practice/${name}.png`, fullPage: true });

const option = (page: Page, letter: string) =>
  page.getByRole("button", { name: new RegExp(`^${letter} `) });

async function noSideways(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test("a junior completes a set on a phone, opened from a parent's link", async ({ page }) => {
  const bytes: number[] = [];
  page.on("requestfinished", async (request) => {
    const sizes = await request.sizes();
    bytes.push(sizes.responseBodySize + sizes.responseHeadersSize);
  });

  await page.goto(linkFor(E2E_STUDENTS.junior.id));
  await expect(page.getByRole("heading", { name: /Hi Kemi!/ })).toBeVisible();
  await expect(page.getByText("Proud of you! Mummy")).toBeVisible();
  await page.waitForLoadState("networkidle");
  // Everything for a load comes in one small HTML response: no scripts, fonts or images to fetch.
  expect(bytes).toHaveLength(1);
  expect(bytes[0]!).toBeLessThan(100_000);
  test.info().annotations.push({ type: "first load", description: `${bytes[0]} bytes` });
  await noSideways(page);
  await shot(page, "1-start");

  await page.getByRole("button", { name: "Start today's questions" }).click();
  for (let i = 0; i < 5; i++) {
    await expect(page.getByText(`Question ${i + 1} of 5`)).toBeVisible();
    if (i === 0) {
      // Large tap targets: every answer is at least 48px tall and spans the screen.
      for (const letter of ["A", "B", "C", "D"]) {
        const box = (await option(page, letter).boundingBox())!;
        expect(box.height).toBeGreaterThanOrEqual(48);
        expect(box.width).toBeGreaterThan(300);
      }
      await noSideways(page);
      await shot(page, "2-question");
    }
    await option(page, i === 1 ? "B" : "A").click();
    if (i === 1) {
      await expect(page.getByText("❌ Not quite. The answer is A.")).toBeVisible();
      await page.getByRole("link", { name: "Explain another way" }).click();
      await expect(page.getByText("Here it is in Pidgin:")).toBeVisible();
      await shot(page, "3-feedback-explain-another-way");
    } else {
      await expect(page.getByText("✅ Correct!")).toBeVisible();
    }
    await page
      .getByRole("button", { name: i === 4 ? "See my score ▶" : "Next question ▶" })
      .click();
  }

  await expect(page.getByRole("heading", { name: "🎉 Well done, Kemi!" })).toBeVisible();
  await expect(page.getByText("4/5")).toBeVisible();
  await expect(page.getByText("day streak 🔥")).toBeVisible();
  await expect(page.getByText(/league/i)).toHaveCount(0); // no leagues with strangers
  await noSideways(page);
  await shot(page, "4-summary-junior");
  for (const b of bytes) expect(b).toBeLessThan(100_000);
});

test("a senior completes a set on the web as a WhatsApp fallback", async ({ page }) => {
  await page.goto(linkFor(E2E_STUDENTS.senior.id));
  await page.getByRole("button", { name: "Start today's questions" }).click();
  for (let i = 0; i < 5; i++) {
    await expect(page.getByText(`Question ${i + 1} of 5`)).toBeVisible();
    await option(page, "A").click();
    await expect(page.getByText("✅ Correct!")).toBeVisible();
    await page
      .getByRole("button", { name: i === 4 ? "See my score ▶" : "Next question ▶" })
      .click();
  }
  await expect(page.getByRole("heading", { name: "🎉 Well done, Tunde!" })).toBeVisible();
  await expect(page.getByText("5/5")).toBeVisible();
  await expect(page.getByRole("heading", { name: "🏆 This week's league" })).toBeVisible();
  await expect(page.getByText("You: 5 correct")).toBeVisible();
  await expect(page.getByText("Kemi")).toHaveCount(0); // juniors aren't in a class league
  await shot(page, "5-summary-senior");
});

test("answers survive a reload and a dropped connection", async ({ page, context, browser }) => {
  const link = linkFor(E2E_STUDENTS.reload.id);
  await page.goto(link);
  await page.getByRole("button", { name: "Start today's questions" }).click();
  await option(page, "A").click();
  await expect(page.getByText("✅ Correct!")).toBeVisible();

  await page.reload();
  await expect(page.getByText("✅ Correct!")).toBeVisible();
  await expect(page.getByText("✓ Answer")).toBeVisible();
  await page.getByRole("button", { name: "Next question ▶" }).click();
  await expect(page.getByText("Question 2 of 5")).toBeVisible();

  // The connection drops just as the student answers: the answer waits on the phone...
  await context.setOffline(true);
  await option(page, "B").click();
  await expect(page.getByText("No connection right now.")).toBeVisible();
  await shot(page, "6-offline");
  // ...and is sent by itself when the phone is back online.
  await context.setOffline(false);
  await expect(page.getByText("❌ Not quite. The answer is A.")).toBeVisible();
  await page.reload();
  await expect(page.getByText("❌ Not quite. The answer is A.")).toBeVisible();
  await expect(page.getByText("✗ Yours")).toBeVisible();

  // It also works with no JavaScript at all: plain forms.
  const plain = await browser.newContext({ javaScriptEnabled: false, ...test.info().project.use });
  const noJs = await plain.newPage();
  await noJs.goto(link);
  await noJs.getByRole("button", { name: "Next question ▶" }).click();
  await expect(noJs.getByText("Question 3 of 5")).toBeVisible();
  await option(noJs, "A").click();
  await expect(noJs.getByText("✅ Correct!")).toBeVisible();
  await plain.close();

  await page.reload();
  await expect(page.getByText("Question 3 of 5")).toBeVisible();
  await expect(page.getByText("✅ Correct!")).toBeVisible();
});

test("an expired or altered link explains itself", async ({ page }) => {
  const res = await page.goto("/p/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
  expect(res!.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "This link doesn't work" })).toBeVisible();
});
