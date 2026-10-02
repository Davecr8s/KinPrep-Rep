// Applies supabase/migrations to the hosted database in SUPABASE_DB_URL.
// Usage: npm run db:push   (reads .env.local)
import { spawnSync } from "node:child_process";

const url = process.env.SUPABASE_DB_URL;
if (!url) {
  console.error("SUPABASE_DB_URL is not set in .env.local (see .env.example).");
  process.exit(1);
}

const extra = process.argv.slice(2);
const result = spawnSync("npx", ["supabase", "db", "push", "--db-url", url, ...extra], {
  stdio: "inherit",
  shell: process.platform === "win32",
});
process.exit(result.status ?? 1);
