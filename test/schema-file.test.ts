import { readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { buildSchema } from "../scripts/build-schema.mjs";
import { createTestDb } from "./db/harness";

// supabase/schema.sql (pasted into the SQL editor of a new project) must match the migrations,
// and must run in one go, as the SQL editor runs it.

const tables = async (db: PGlite) =>
  (
    await db.query<{ t: string }>(
      "select table_name as t from information_schema.tables where table_schema = 'public' order by 1",
    )
  ).rows.map((r) => r.t);

describe("supabase/schema.sql", () => {
  it("is up to date with supabase/migrations (run `npm run db:schema`)", () => {
    expect(readFileSync("supabase/schema.sql", "utf8")).toBe(buildSchema());
  });

  it("runs as one script and builds the same tables as the migrations", async () => {
    const fromMigrations = await createTestDb();
    const fromSchema = await createTestDb({ migrations: false });
    await fromSchema.exec(readFileSync("supabase/schema.sql", "utf8"));
    expect(await tables(fromSchema)).toEqual(await tables(fromMigrations));
    // The CLI's history says every migration is applied, so db:push won't run them again.
    const { rows } = await fromSchema.query<{ version: string }>(
      "select version from supabase_migrations.schema_migrations order by 1",
    );
    expect(rows.map((r) => r.version)).toEqual(
      buildSchema()
        .match(/\('(\d{14})', '/g)!
        .map((m) => m.slice(2, 16)),
    );
  }, 60_000);
});
