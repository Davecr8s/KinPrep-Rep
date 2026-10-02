import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  ApplyResultSchema,
  SUBSCRIPTION_COLUMNS,
  toCoverage,
  toSponsoredStudent,
  toSubscriptionRecord,
} from "./rows";
import type { BillingStore } from "./types";

/** BillingStore over Supabase, using the service-role client (server only). */
export function createSupabaseBillingStore(db: SupabaseClient): BillingStore {
  function fail(what: string, error: { message: string }): never {
    throw new Error(`${what} failed: ${error.message}`);
  }

  return {
    async applyBillingEvent(update) {
      const { data, error } = await db.rpc("apply_billing_event", { p: update });
      if (error) fail("apply_billing_event", error);
      return ApplyResultSchema.parse(data).result;
    },

    async getCoverages(studentId, at) {
      const { data, error } = await db.rpc("student_coverages", {
        p_student_id: studentId,
        p_at: at.toISOString(),
      });
      if (error) fail("student_coverages", error);
      return z.array(z.unknown()).parse(data).map(toCoverage);
    },

    async hasGuardianConsent(studentId) {
      const { data, error } = await db
        .from("guardian_consents")
        .select("event")
        .eq("student_id", studentId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) fail("hasGuardianConsent", error);
      return data?.event === "granted";
    },

    async hasAnySubscription(studentId) {
      const { count, error } = await db
        .from("subscriptions")
        .select("id", { count: "exact", head: true })
        .eq("student_id", studentId);
      if (error) fail("hasAnySubscription", error);
      return (count ?? 0) > 0;
    },

    async getSubscription(id) {
      const { data, error } = await db
        .from("subscriptions")
        .select(SUBSCRIPTION_COLUMNS)
        .eq("id", id)
        .maybeSingle();
      if (error) fail("getSubscription", error);
      return data ? toSubscriptionRecord(data) : null;
    },

    async findSponsorLink(code) {
      const { data, error } = await db
        .from("sponsor_links")
        .select("student_id, students!inner(first_name, class, exam)")
        .eq("code", code)
        .is("revoked_at", null)
        .maybeSingle();
      if (error) fail("findSponsorLink", error);
      if (!data) return null;
      const { students, ...link } = z
        .object({ student_id: z.string(), students: z.record(z.string(), z.unknown()) })
        .parse(data);
      return toSponsoredStudent({ ...link, ...students });
    },

    async findActiveAmbassador(code) {
      const { data, error } = await db
        .from("ambassadors")
        .select("id, code")
        .eq("code", code)
        .eq("active", true)
        .maybeSingle();
      if (error) fail("findActiveAmbassador", error);
      if (!data) return null;
      const row = z.object({ id: z.string(), code: z.string() }).parse(data);
      return { ambassadorId: row.id, code: row.code };
    },
  };
}
