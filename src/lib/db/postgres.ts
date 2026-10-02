import "server-only";
import postgres from "postgres";
import { serverEnv } from "@/lib/env";
import type { Sql } from "./sql";

let client: postgres.Sql | undefined;

function wrap(sql: postgres.Sql | postgres.TransactionSql): Sql {
  return {
    async query<T>(text: string, params: unknown[] = []) {
      return (await sql.unsafe(
        text,
        params as postgres.ParameterOrJSON<never>[],
      )) as unknown as T[];
    },
    async transaction<T>(fn: (tx: Sql) => Promise<T>): Promise<T> {
      if (!("begin" in sql)) return fn(wrap(sql)); // already inside one
      return (await sql.begin((tx) => fn(wrap(tx)))) as T;
    },
  };
}

/**
 * Direct Postgres for the bot. SUPABASE_DB_URL must be the *transaction pooler* URL (port 6543)
 * on Vercel; prepared statements are off because the pooler doesn't keep them.
 */
export function appSql(): Sql {
  const env = serverEnv("database");
  client ??= postgres(env.SUPABASE_DB_URL, {
    prepare: false,
    max: env.SUPABASE_DB_POOL_MAX,
    idle_timeout: 20,
  });
  return wrap(client);
}
