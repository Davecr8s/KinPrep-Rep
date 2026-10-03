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
      include: [
        "src/lib/rules/**",
        "src/config/**",
        "src/lib/engine/select.ts",
        "src/lib/engine/mastery.ts",
        "src/lib/engine/runway.ts",
        "src/lib/jobs/rules.ts",
      ],
      exclude: ["**/*.test.ts"],
      // Business rules and the engine's decisions must be fully tested (CLAUDE.md, Phase 2).
      thresholds: {
        "src/lib/rules/**": { lines: 100, branches: 100, functions: 100 },
        "src/lib/engine/{select,mastery,runway}.ts": { lines: 100, branches: 100, functions: 100 },
        "src/lib/jobs/rules.ts": { lines: 100, branches: 100, functions: 100 },
      },
    },
  },
});
