import { expect, test } from "@playwright/test";
import { E2E_CRON_SECRET } from "./support/fixtures";

// The scheduled-jobs endpoint as Vercel Cron calls it, against the e2e database.

const auth = { Authorization: `Bearer ${E2E_CRON_SECRET}` };

test("refuses calls without the cron secret", async ({ request }) => {
  expect((await request.get("/api/jobs/morning?dryRun=1")).status()).toBe(401);
  const wrong = await request.get("/api/jobs/morning?dryRun=1", {
    headers: { Authorization: "Bearer not-the-secret-not-the-secret-not-the" },
  });
  expect(wrong.status()).toBe(401);
});

test("a dry run lists who would get what, and sends nothing", async ({ request }) => {
  const res = await request.get("/api/jobs/junior-links?dryRun=1", { headers: auth });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as {
    dryRun: boolean;
    text: string;
    worker: unknown;
    planned: { channel: string; to: string; about: string; queued: boolean }[];
  };
  expect(body.dryRun).toBe(true);
  expect(body.worker).toBeNull();
  // Kemi's parent hasn't opted in to WhatsApp, so the junior link goes by email.
  expect(body.planned).toEqual([
    expect.objectContaining({ channel: "email", to: "e2e-parent@example.com", about: "Kemi" }),
  ]);
  expect(body.text).toContain("DRY RUN (nothing sent)");
  // The same dry run again adds nothing.
  const again = (await (
    await request.get("/api/jobs/junior-links?dryRun=1", { headers: auth })
  ).json()) as { planned: { queued: boolean }[] };
  expect(again.planned.every((p) => !p.queued)).toBe(true);
});

test("rejects unknown jobs and a time override outside a dry run", async ({ request }) => {
  expect((await request.get("/api/jobs/nope", { headers: auth })).status()).toBe(404);
  const at = await request.get("/api/jobs/morning?at=2026-10-11T07:00:00Z", { headers: auth });
  expect(at.status()).toBe(400);
});
