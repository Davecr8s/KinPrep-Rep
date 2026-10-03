import type { Sql } from "@/lib/db/sql";

// Shared by the admin services: the role check (done again here, whatever the page did) and the
// audit log every admin change is written to.

export class AdminError extends Error {}

export type Admin = { id: string };

export async function adminMember(sql: Sql, userId: string): Promise<Admin> {
  const [row] = await sql.query<{ role: string }>(
    "select role::text from public.profiles where id = $1",
    [userId],
  );
  if (row?.role !== "admin") throw new AdminError("Only admins can do that.");
  return { id: userId };
}

export async function audit(
  sql: Sql,
  admin: Admin,
  action: string,
  entityType: string,
  entityId: string | null,
  details: Record<string, unknown> = {},
): Promise<void> {
  await sql.query(
    `insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
     values ($1, $2, $3, $4, $5::jsonb)`,
    [admin.id, action, entityType, entityId, JSON.stringify(details)],
  );
}
