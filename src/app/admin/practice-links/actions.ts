"use server";

import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { appSql } from "@/lib/db/postgres";
import { serverEnv } from "@/lib/env";
import { todaysLinks } from "@/lib/practice/daily-links";

const PAGE = "/admin/practice-links";

/** One click: today's links for every active student. Logged in audit_log. */
export async function generateTodaysLinks(): Promise<never> {
  const admin = await requireAdmin(PAGE);
  const issuedAt = new Date(Math.floor(Date.now() / 1000) * 1000);
  const sql = appSql();
  const links = await todaysLinks(sql, {
    appUrl: serverEnv("app").NEXT_PUBLIC_APP_URL,
    secret: serverEnv("practice").PRACTICE_LINK_SECRET,
    issuedAt,
  });
  await sql.query(
    `insert into public.audit_log (actor_id, action, entity_type, details)
     values ($1, 'practice_links.generated', 'practice_link', $2::jsonb)`,
    [
      admin.id,
      JSON.stringify({
        issued_at: issuedAt.toISOString(),
        count: links.length,
        juniors: links.filter((l) => l.junior).length,
      }),
    ],
  );
  redirect(`${PAGE}?at=${issuedAt.getTime() / 1000}`);
}
