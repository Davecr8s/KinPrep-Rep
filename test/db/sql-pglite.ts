import type { PGlite, Transaction } from "@electric-sql/pglite";
import type { Sql } from "@/lib/db/sql";

/** The app's Sql interface over PGlite, for tests. */
export function pgliteSql(db: PGlite | Transaction): Sql {
  return {
    async query<T>(text: string, params: unknown[] = []) {
      return (await db.query<T>(text, params)).rows;
    },
    async transaction<T>(fn: (tx: Sql) => Promise<T>): Promise<T> {
      if (!("transaction" in db)) return fn(pgliteSql(db));
      return db.transaction((tx) => fn(pgliteSql(tx)));
    },
  };
}
