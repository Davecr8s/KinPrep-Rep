import type { PGlite } from "@electric-sql/pglite";
import {
  ApplyResultSchema,
  SUBSCRIPTION_COLUMNS,
  toCoverage,
  toSponsoredStudent,
  toSubscriptionRecord,
} from "@/lib/payments/rows";
import type { BillingStore } from "@/lib/payments/types";

/** BillingStore over PGlite, calling the same SQL functions the Supabase store calls. */
export function createPgBillingStore(db: PGlite): BillingStore {
  return {
    async applyBillingEvent(update) {
      const { rows } = await db.query<{ r: unknown }>(
        "select public.apply_billing_event($1::jsonb) as r",
        [JSON.stringify(update)],
      );
      return ApplyResultSchema.parse(rows[0]!.r).result;
    },
    async getCoverages(studentId, at) {
      const { rows } = await db.query("select * from public.student_coverages($1, $2)", [
        studentId,
        at.toISOString(),
      ]);
      return rows.map(toCoverage);
    },
    async hasAnySubscription(studentId) {
      const { rows } = await db.query("select 1 from public.subscriptions where student_id = $1", [
        studentId,
      ]);
      return rows.length > 0;
    },
    async getSubscription(id) {
      const { rows } = await db.query(
        `select ${SUBSCRIPTION_COLUMNS} from public.subscriptions where id = $1`,
        [id],
      );
      return rows[0] ? toSubscriptionRecord(rows[0]) : null;
    },
    async findSponsorLink(code) {
      const { rows } = await db.query(
        `select l.student_id, s.first_name, s.class, s.exam
         from public.sponsor_links l join public.students s on s.id = l.student_id
         where l.code = $1 and l.revoked_at is null`,
        [code],
      );
      return rows[0] ? toSponsoredStudent(rows[0]) : null;
    },
    async findActiveAmbassador(code) {
      const { rows } = await db.query<{ id: string; code: string }>(
        "select id, code from public.ambassadors where code = $1 and active",
        [code],
      );
      return rows[0] ? { ambassadorId: rows[0].id, code: rows[0].code } : null;
    },
  };
}
