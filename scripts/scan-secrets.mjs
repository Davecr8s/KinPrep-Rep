// Fails if any file tracked by git looks like it contains a real secret (API keys, webhook
// secrets, tokens, database passwords). Runs in CI and in the unit tests (test/security.test.ts).
// Fake values in tests are short on purpose ("sk_test_123") and don't match.
//   node scripts/scan-secrets.mjs

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

export const SECRET_PATTERNS = [
  ["Stripe secret key", /\b[sr]k_(live|test)_[A-Za-z0-9]{20,}/],
  ["Stripe webhook secret", /\bwhsec_[A-Za-z0-9]{20,}/],
  ["Paystack secret key", /\bsk_(live|test)_[a-f0-9]{30,}/],
  ["Supabase secret key", /\bsb_secret_[A-Za-z0-9_-]{20,}/],
  [
    "Supabase service-role JWT",
    /\beyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/,
  ],
  ["Anthropic API key", /\bsk-ant-[A-Za-z0-9_-]{30,}/],
  ["Resend API key", /\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{16,}/],
  ["Meta access token", /\bEAA[A-Za-z0-9]{60,}/],
  ["Sentry auth token", /\bsntrys_[A-Za-z0-9_=-]{30,}/],
  ["Private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  // A database URL with a password, unless it points at this machine (tests, e2e) or the
  // password is a placeholder like <password> (docs).
  [
    "Database password",
    /postgres(?:ql)?:\/\/[^:\s/]+:(?![<[])[^@\s]{6,}@(?!localhost|127\.0\.0\.1|\[::1\])[^\s"'`]+/,
  ],
];

const SKIP = [/^package-lock\.json$/, /\.(png|jpg|jpeg|gif|ico|webp|woff2?|pdf)$/i];

export function findSecrets(files, read = (f) => readFileSync(f, "utf8")) {
  const found = [];
  for (const file of files) {
    if (SKIP.some((re) => re.test(file))) continue;
    let text;
    try {
      text = read(file);
    } catch {
      continue; // deleted in the working tree
    }
    text.split("\n").forEach((line, i) => {
      for (const [name, re] of SECRET_PATTERNS) {
        if (re.test(line)) found.push({ file, line: i + 1, name });
      }
    });
  }
  return found;
}

export function trackedFiles() {
  return execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean);
}

if (
  import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}` ||
  process.argv[1]?.endsWith("scan-secrets.mjs")
) {
  const found = findSecrets(trackedFiles());
  if (found.length) {
    for (const f of found) console.error(`${f.file}:${f.line}: looks like a ${f.name}`);
    console.error("\nRemove it, rotate the key, and keep secrets in .env.local / Vercel only.");
    process.exit(1);
  }
  console.log("No secrets found in tracked files.");
}
