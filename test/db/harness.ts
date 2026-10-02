import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite, type Transaction } from "@electric-sql/pglite";

// An in-process Postgres with the bits of Supabase our migrations rely on: the auth schema,
// auth.uid(), the anon/authenticated/service_role roles and Supabase's default grants (which give
// signed-in users table access that only RLS then restricts).
const SUPABASE_SHIM = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema auth, public to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`;

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

export async function createTestDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_SHIM);
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  for (const file of files) {
    await db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  }
  return db;
}

/** Runs `fn` as a signed-in Supabase user (role authenticated, auth.uid() = userId). */
export async function asUser<T>(
  db: PGlite,
  userId: string,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    return fn(tx);
  });
}

export async function createUser(
  db: PGlite,
  role: "payer" | "group_buyer" | "reviewer" | "ambassador" | "admin" = "payer",
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    "insert into auth.users default values returning id",
  );
  const id = rows[0]!.id;
  await db.query("insert into public.profiles (id, role) values ($1, $2)", [id, role]);
  if (role === "payer") {
    await db.query(
      "insert into public.payers (id, region, currency, timezone) values ($1, 'abroad', 'GBP', 'Europe/London')",
      [id],
    );
  }
  return id;
}

const lagosYear = () =>
  Number(
    new Intl.DateTimeFormat("en", { timeZone: "Africa/Lagos", year: "numeric" }).format(new Date()),
  );

export const SENIOR_BIRTH_YEAR = lagosYear() - 15;
export const JUNIOR_BIRTH_YEAR = lagosYear() - 12;

export async function createStudent(
  db: PGlite,
  ownerId: string,
  overrides: { firstName?: string; birthYear?: number; whatsapp?: string | null } = {},
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.students (owner_id, first_name, last_initial, class, birth_year, exam, subjects, whatsapp_number)
     values ($1, $2, 'O', 'SS2', $3, 'WASSCE', '{english,mathematics}', $4) returning id`,
    [
      ownerId,
      overrides.firstName ?? "Ada",
      overrides.birthYear ?? SENIOR_BIRTH_YEAR,
      overrides.whatsapp ?? null,
    ],
  );
  return rows[0]!.id;
}

export async function createGroup(db: PGlite, ownerId: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    "insert into public.group_accounts (owner_id, name, kind) values ($1, 'Grace Chapel', 'church') returning id",
    [ownerId],
  );
  return rows[0]!.id;
}
