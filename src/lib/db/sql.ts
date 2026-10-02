// A minimal SQL interface for server code that needs real transactions (the WhatsApp bot).
// Production runs it on postgres.js through Supabase's pooler (src/lib/db/postgres.ts); tests
// run the same code on PGlite (test/db/sql-pglite.ts).

export interface Sql {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  transaction<T>(fn: (tx: Sql) => Promise<T>): Promise<T>;
}
