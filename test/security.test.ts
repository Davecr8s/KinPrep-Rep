import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { SECURITY_HEADERS } from "../next.config";
import { envGroups } from "@/lib/env";
import { findSecrets, trackedFiles } from "../scripts/scan-secrets.mjs";

// Static checks that keep the launch hardening from regressing: every route and server action
// has its guard, secrets stay on the server, every environment variable is documented, and no
// secret is committed.

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}
const files = walk("src").map((f) => relative(".", f).replace(/\\/g, "/"));
const read = (f: string) => readFileSync(f, "utf8");

/**
 * Every route handler and the guard it must use. A new route fails this test until it is added
 * here, so nobody ships an unprotected endpoint by accident.
 */
const ROUTE_GUARDS: Record<string, RegExp[]> = {
  "src/app/api/explain/route.ts": [/limitRequest\(request, "explain"\)/, /handleExplainPost/],
  "src/app/api/jobs/[job]/route.ts": [/hasBearer\(request, serverEnv\("cron"\)\.CRON_SECRET\)/],
  "src/app/api/webhooks/stripe/route.ts": [/limitRequest\(request, "webhook"\)/],
  "src/app/api/webhooks/paystack/route.ts": [/limitRequest\(request, "webhook"\)/],
  "src/app/api/whatsapp/route.ts": [/limitRequest\(request, "webhook"\)/, /verifyMetaSignature/],
  "src/app/api/health/route.ts": [/hasBearer\(request, process\.env\.CRON_SECRET\)/],
  "src/app/p/[token]/route.ts": [/limitRequest\(request, "practice"\)/],
  "src/app/auth/confirm/route.ts": [/limitRequest\(request, "authConfirm"\)/],
  "src/app/app/(main)/children/[id]/export/route.ts": [/requireOwnedStudent\(id\)/],
  "src/app/admin/(console)/students/[id]/export/route.ts": [/requireAdmin\(/, /audit\(/],
  "src/app/admin/questions/export/route.ts": [/requireStaff\(/],
  "src/app/pwa-icon/[variant]/route.tsx": [], // static icon, no data
};

describe("API routes", () => {
  const routes = files.filter((f) => /\/route\.tsx?$/.test(f));

  it("are all listed with their guard", () => {
    expect(routes.sort()).toEqual(Object.keys(ROUTE_GUARDS).sort());
  });

  it.each(Object.entries(ROUTE_GUARDS))("%s has its guard", (file, guards) => {
    const source = read(file);
    for (const guard of guards) expect(source).toMatch(guard);
  });

  it("verify payment webhook signatures inside the providers", () => {
    expect(read("src/lib/payments/stripe.ts")).toMatch(/constructEvent/);
    expect(read("src/lib/payments/paystack.ts")).toMatch(/x-paystack-signature/);
  });
});

describe("server actions", () => {
  // Each exported action must start by checking who is calling, or (public forms) rate-limit.
  const GUARD =
    /require(Admin|Staff|User|Payer|OwnedStudent)\(|\badmin\(|\bstaff\(|withinLimit\(|return run\(/;
  const PUBLIC = new Set(["signOut"]);
  const actions = files
    .filter((f) => /\.tsx?$/.test(f) && read(f).startsWith('"use server"'))
    .flatMap((file) => {
      const source = read(file);
      return [...source.matchAll(/export async function (\w+)\([\s\S]*?\n\}/g)].map((m) => ({
        file,
        name: m[1]!,
        body: m[0],
      }));
    });

  it("exist", () => expect(actions.length).toBeGreaterThan(30));

  it.each(actions.map((a) => [`${a.file} ${a.name}`, a] as const))("%s is guarded", (_, a) => {
    if (PUBLIC.has(a.name)) return;
    expect(a.body).toMatch(GUARD);
  });
});

describe("secrets stay on the server", () => {
  const clientFiles = files.filter(
    (f) => /\.tsx?$/.test(f) && /^\s*["']use client["']/.test(read(f)),
  );
  const SERVER_ONLY = [
    "@/lib/env",
    "@/lib/db/",
    "@/lib/supabase/server",
    "@/lib/services/",
    "@/lib/security/",
    "@/lib/monitoring/report",
    "@/lib/payments/server",
    "server-only",
  ];

  it("client components import no server modules and read no server env", () => {
    expect(clientFiles.length).toBeGreaterThan(0);
    for (const file of clientFiles) {
      const source = read(file);
      for (const mod of SERVER_ONLY) expect(source, file).not.toContain(`from "${mod}`);
      for (const [, name] of source.matchAll(/process\.env\.(\w+)/g)) {
        expect(name, file).toMatch(/^NEXT_PUBLIC_/);
      }
    }
  });

  it("server modules that hold secrets are marked server-only", () => {
    for (const file of [
      "src/lib/env.ts",
      "src/lib/db/postgres.ts",
      "src/lib/db/admin.ts",
      "src/lib/security/server.ts",
      "src/lib/services/data-rights.ts",
    ]) {
      expect(read(file), file).toMatch(/^import "server-only";/);
    }
  });

  it("no NEXT_PUBLIC_ variable is a secret", () => {
    const publicVars = [...read(".env.example").matchAll(/^(NEXT_PUBLIC_\w+)=/gm)].map((m) => m[1]);
    expect(publicVars.sort()).toEqual(
      [
        "NEXT_PUBLIC_APP_URL",
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
        "NEXT_PUBLIC_SUPABASE_URL",
      ].sort(),
    );
  });

  it("no tracked file contains a secret", () => {
    expect(findSecrets(trackedFiles())).toEqual([]);
  });
});

describe("environment variables", () => {
  // Set by the platform, not by us.
  const PLATFORM = new Set([
    "NODE_ENV",
    "NEXT_RUNTIME",
    "VERCEL_ENV",
    "VERCEL_GIT_COMMIT_SHA",
    "CI",
  ]);
  const fromSchema = Object.values(envGroups).flatMap((g) => Object.keys(g.shape));
  const fromCode = files
    .filter((f) => /\.tsx?$/.test(f) && !f.includes(".test."))
    .flatMap((f) => [...read(f).matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((m) => m[1]!));
  const all = [...new Set([...fromSchema, ...fromCode])].filter((v) => !PLATFORM.has(v)).sort();

  it("are all in .env.example", () => {
    const example = read(".env.example");
    const missing = all.filter((v) => !new RegExp(`^${v}=`, "m").test(example));
    expect(missing).toEqual([]);
  });

  it("are all documented in docs/LAUNCH.md", () => {
    const launch = read("docs/LAUNCH.md");
    const missing = all.filter((v) => !launch.includes(`\`${v}\``));
    expect(missing).toEqual([]);
  });
});

describe("security headers", () => {
  it("are sent on every page", () => {
    const keys = SECURITY_HEADERS.map((h) => h.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        "Strict-Transport-Security",
        "X-Content-Type-Options",
        "X-Frame-Options",
        "Referrer-Policy",
        "Content-Security-Policy",
      ]),
    );
    const csp = SECURITY_HEADERS.find((h) => h.key === "Content-Security-Policy")!.value;
    expect(csp).toContain("frame-ancestors 'none'");
  });
});
