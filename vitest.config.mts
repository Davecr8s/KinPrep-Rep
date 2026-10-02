import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: {
      // "server-only" throws outside a React Server Components build; stub it in unit tests.
      "server-only": fileURLToPath(new URL("./test/server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    // Each database test file boots its own in-process Postgres (PGlite).
    testTimeout: 20_000,
    hookTimeout: 60_000,
    coverage: {
      provider: "v8",
      include: ["src/lib/rules/**", "src/config/**"],
      exclude: ["**/*.test.ts"],
      // Business rules must be fully tested (CLAUDE.md, BUILD_PLAN Phase 2).
      thresholds: { "src/lib/rules/**": { lines: 100, branches: 100, functions: 100 } },
    },
  },
});
