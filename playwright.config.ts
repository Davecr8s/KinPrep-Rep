import { defineConfig, devices } from "@playwright/test";
import {
  E2E_CRON_SECRET,
  E2E_DB_PORT,
  E2E_DB_URL,
  E2E_PRACTICE_SECRET,
} from "./e2e/support/fixtures";

const port = 3000;
// E2E_BASE_URL: run against a deployed site (a Vercel preview) instead of starting one here.
const remote = process.env.E2E_BASE_URL;
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: remote ?? `http://localhost:${port}`,
    trace: "on-first-retry",
    // Gets past Vercel's protection on preview deployments (docs/LAUNCH.md).
    extraHTTPHeaders: bypass
      ? { "x-vercel-protection-bypass": bypass, "x-vercel-set-bypass-cookie": "true" }
      : undefined,
  },
  // Students and parents are mostly on Android phones, so test a phone first.
  projects: [{ name: "mobile-chrome", use: { ...devices["Pixel 7"] } }],
  webServer: remote
    ? undefined
    : [
        {
          // A throwaway in-memory Postgres with the migrations and fake students (e2e/support).
          command: "node e2e/support/db-server.ts",
          port: E2E_DB_PORT,
          reuseExistingServer: false,
          timeout: 60_000,
        },
        {
          // CI tests the production build; locally, reuse a running `npm run dev` (start it with
          // the env below if you want the practice tests to pass against it).
          command: process.env.CI ? `npm run start -- -p ${port}` : `npm run dev -- -p ${port}`,
          url: `http://localhost:${port}`,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          env: {
            SUPABASE_DB_URL: E2E_DB_URL,
            SUPABASE_DB_POOL_MAX: "1",
            PRACTICE_LINK_SECRET: E2E_PRACTICE_SECRET,
            CRON_SECRET: E2E_CRON_SECRET,
            NEXT_PUBLIC_APP_URL: `http://localhost:${port}`,
          },
        },
      ],
});
