// Builds supabase/schema.sql: every migration in supabase/migrations, in order, as one script to
// paste into the Supabase SQL editor of a NEW, EMPTY project (e.g. production). It ends by
// recording the migrations as applied, so `npm run db:push` later only applies newer ones.
// The migrations stay the source of truth; test/schema-file.test.ts fails if this file is stale.
//   npm run db:schema

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DIR = "supabase/migrations";

export function buildSchema() {
  const files = readdirSync(DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const parts = [
    "-- KinPrep database schema, generated from supabase/migrations by `npm run db:schema`.",
    "-- Do not edit: change a migration (or add one) and regenerate.",
    "--",
    "-- Only for a NEW, EMPTY Supabase project: paste all of it into SQL Editor > New query > Run.",
    "-- On a project that already has the tables, use `npm run db:push` instead.",
    "",
  ];
  for (const file of files) {
    parts.push(`-- ===== ${file} =====`, readFileSync(join(DIR, file), "utf8").trimEnd(), "");
  }
  const versions = files.map((f) => {
    const [, version, name] = f.match(/^(\d+)_(.+)\.sql$/);
    return `  ('${version}', '${name}')`;
  });
  parts.push(
    "-- ===== Migration history =====",
    "-- Tells the Supabase CLI these migrations are applied, so `npm run db:push` skips them.",
    "create schema if not exists supabase_migrations;",
    "create table if not exists supabase_migrations.schema_migrations (",
    "  version text not null primary key,",
    "  statements text[],",
    "  name text",
    ");",
    "insert into supabase_migrations.schema_migrations (version, name) values",
    `${versions.join(",\n")}`,
    "on conflict (version) do nothing;",
    "",
  );
  return parts.join("\n");
}

if (process.argv[1]?.endsWith("build-schema.mjs")) {
  writeFileSync("supabase/schema.sql", buildSchema());
  console.log("Wrote supabase/schema.sql");
}
