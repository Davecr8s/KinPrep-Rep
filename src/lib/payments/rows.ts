import { z } from "zod";
import type { Coverage } from "@/lib/rules/access";
import type { SponsoredStudent, SubscriptionRecord } from "./types";

// Database rows -> domain objects. Supabase returns timestamps as strings, PGlite (tests) as Dates.

const Timestamp = z
  .union([z.string(), z.date()])
  .nullable()
  .transform((value) => (value === null ? null : new Date(value)));

const Status = z.enum(["incomplete", "trialing", "active", "past_due", "canceled"]);

export const CoverageRowSchema = z.object({
  status: Status,
  current_period_end: Timestamp,
  trial_end: Timestamp,
  grace_until: Timestamp,
});

export function toCoverage(row: unknown): Coverage {
  const r = CoverageRowSchema.parse(row);
  return {
    status: r.status,
    currentPeriodEnd: r.current_period_end,
    trialEnd: r.trial_end,
    graceUntil: r.grace_until,
  };
}

export const SUBSCRIPTION_COLUMNS =
  "id, provider, provider_subscription_id, provider_customer_id, provider_meta, status, current_period_end";

const SubscriptionRowSchema = z.object({
  id: z.string(),
  provider: z.enum(["stripe", "paystack", "manual"]),
  provider_subscription_id: z.string().nullable(),
  provider_customer_id: z.string().nullable(),
  provider_meta: z.record(z.string(), z.unknown()),
  status: Status,
  current_period_end: Timestamp,
});

export function toSubscriptionRecord(row: unknown): SubscriptionRecord {
  const r = SubscriptionRowSchema.parse(row);
  return {
    id: r.id,
    provider: r.provider,
    providerSubscriptionId: r.provider_subscription_id,
    providerCustomerId: r.provider_customer_id,
    providerMeta: r.provider_meta,
    status: r.status,
    currentPeriodEnd: r.current_period_end,
  };
}

const SponsorRowSchema = z.object({
  student_id: z.string(),
  first_name: z.string(),
  class: z.string(),
  exam: z.string(),
});

export function toSponsoredStudent(row: unknown): SponsoredStudent {
  const r = SponsorRowSchema.parse(row);
  return { studentId: r.student_id, firstName: r.first_name, className: r.class, exam: r.exam };
}

export const ApplyResultSchema = z.object({ result: z.enum(["applied", "duplicate"]) });
