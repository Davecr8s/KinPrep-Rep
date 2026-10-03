import { z } from "zod";
import { QUESTIONS_PER_DAY, STREAK_DAY_THRESHOLD } from "@/config/pilot";
import { PLANS, type Currency, type PlanId } from "@/config/pricing";
import { SENDING_LIMITS } from "@/config/messaging";
import type { Sql } from "@/lib/db/sql";
import { streakThreshold } from "@/lib/engine";
import { sendingLimits } from "@/lib/jobs/queue";
import {
  billingSettingsFrom,
  MAX_GRACE_DAYS,
  priceOverrides,
  type BillingSettings,
} from "@/lib/payments/billing-settings";
import { questionsPerDay } from "@/lib/practice/repo";
import { lagosDay } from "@/lib/rules/days";
import { audit, AdminError, type Admin } from "./common";
import { handSentText, waMeLink } from "./rules";

// Settings, the pilot console's hand-sent messages, and the message log.

// ---- Settings ---------------------------------------------------------------------------

export type AdminSettings = {
  questionsPerDay: number;
  reminderEnabled: boolean;
  streakThreshold: number;
  waPerSecond: number;
  waPerDay: number;
  billing: BillingSettings;
};

export async function readSettings(sql: Sql): Promise<AdminSettings> {
  const [reminder] = await sql.query<{ value: unknown }>(
    "select value from public.settings where key = 'reminder_enabled'",
  );
  const limits = await sendingLimits(sql);
  return {
    questionsPerDay: await questionsPerDay(sql),
    reminderEnabled: reminder?.value === true || reminder?.value === "true",
    streakThreshold: await streakThreshold(sql),
    waPerSecond: limits.perSecond,
    waPerDay: limits.perDay,
    billing: billingSettingsFrom(
      await sql.query(
        "select key, value from public.settings where key in ('price_overrides', 'grace_days')",
      ),
    ),
  };
}

const priceField = z.coerce
  .number({ error: "Enter a price." })
  .positive("Prices must be above zero.")
  .max(1_000_000, "That price looks too high.");

/** The settings form: prices are entered in major units (e.g. 6.00 GBP, 500 NGN). */
export const SettingsInputSchema = z.object({
  questionsPerDay: z.coerce.number().int().min(1).max(QUESTIONS_PER_DAY.max),
  reminderEnabled: z.boolean(),
  streakThreshold: z.coerce.number().int().min(1).max(20),
  graceDays: z.coerce.number().int().min(0).max(MAX_GRACE_DAYS),
  waPerSecond: z.coerce.number().int().min(1).max(80),
  waPerDay: z.coerce.number().int().min(1).max(100_000),
  prices: z.record(z.string(), z.record(z.string(), priceField)),
});
export type SettingsInput = z.output<typeof SettingsInputSchema>;

export async function saveSettings(sql: Sql, admin: Admin, input: SettingsInput): Promise<void> {
  if (input.streakThreshold > input.questionsPerDay) {
    throw new AdminError("The streak threshold can't be more than the questions per day.");
  }
  const before = await readSettings(sql);
  const prices = structuredClone(before.billing.prices);
  for (const [plan, byCurrency] of Object.entries(input.prices)) {
    if (!(plan in PLANS)) continue;
    for (const [currency, major] of Object.entries(byCurrency)) {
      const sold: Partial<Record<Currency, number>> = PLANS[plan as PlanId].prices;
      if (currency in sold) prices[plan as PlanId][currency as Currency] = Math.round(major * 100);
    }
  }
  const values: Record<string, unknown> = {
    questions_per_day: input.questionsPerDay,
    reminder_enabled: input.reminderEnabled,
    streak_day_threshold: input.streakThreshold,
    grace_days: input.graceDays,
    wa_messages_per_second: input.waPerSecond,
    wa_messages_per_day: input.waPerDay,
    price_overrides: priceOverrides(prices),
  };
  await sql.transaction(async (tx) => {
    for (const [key, value] of Object.entries(values)) {
      await tx.query(
        `insert into public.settings (key, value, updated_at, updated_by) values ($1, $2::jsonb, now(), $3)
         on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by`,
        [key, JSON.stringify(value), admin.id],
      );
    }
    await audit(tx, admin, "settings.updated", "settings", null, {
      before: {
        ...before,
        billing: {
          graceDays: before.billing.graceDays,
          prices: priceOverrides(before.billing.prices),
        },
      },
      after: values,
    });
  });
}

export const SETTING_DEFAULTS = {
  questionsPerDay: QUESTIONS_PER_DAY.default,
  streakThreshold: STREAK_DAY_THRESHOLD,
  waPerSecond: SENDING_LIMITS.perSecond,
  waPerDay: SENDING_LIMITS.perDay,
};

// ---- Pilot console ----------------------------------------------------------------------

export type HandSent = {
  id: number;
  job: string;
  channel: "whatsapp" | "email";
  recipient: string;
  about: string | null;
  text: string;
  status: "manual" | "sent";
  sent_at: Date | null;
  sent_by_email: string | null;
  /** wa.me link (WhatsApp) or mailto link (email) that opens the message ready to send. */
  link: string;
};

/** Today's hand-sent messages: still to send, and already sent. */
export async function pilotQueue(sql: Sql, now: Date): Promise<HandSent[]> {
  const rows = await sql.query<{
    id: number;
    job: string;
    channel: "whatsapp" | "email";
    recipient: string;
    about: string | null;
    preview: string;
    payload: { subject?: string; text?: string };
    status: "manual" | "sent";
    sent_at: Date | null;
    sent_by_email: string | null;
  }>(
    `select q.id::int, q.job, q.channel, q.recipient, s.first_name as about, q.preview, q.payload,
            q.status, q.sent_at, u.email as sent_by_email
     from public.outbound_queue q
     left join public.students s on s.id = q.student_id
     left join auth.users u on u.id = q.sent_by
     where not q.dry_run and q.lagos_day = $1
       and (q.status = 'manual' or (q.status = 'sent' and q.sent_by is not null))
     order by q.job, q.status desc, q.id`,
    [lagosDay(now)],
  );
  return rows.map((r) => {
    const text = r.channel === "email" ? (r.payload.text ?? r.preview) : handSentText(r.preview);
    return {
      id: r.id,
      job: r.job,
      channel: r.channel,
      recipient: r.recipient,
      about: r.about,
      text,
      status: r.status,
      sent_at: r.sent_at,
      sent_by_email: r.sent_by_email,
      link:
        r.channel === "whatsapp"
          ? waMeLink(r.recipient, text)
          : `mailto:${r.recipient}?subject=${encodeURIComponent(r.payload.subject ?? "KinPrep")}&body=${encodeURIComponent(text)}`,
    };
  });
}

export async function markSent(sql: Sql, admin: Admin, id: number, now: Date): Promise<void> {
  const rows = await sql.query(
    `update public.outbound_queue set status = 'sent', sent_at = $2, sent_by = $3,
       provider_message_id = 'hand-sent', attempts = attempts + 1
     where id = $1 and status = 'manual' returning id`,
    [id, now, admin.id],
  );
  if (!rows.length) throw new AdminError("That message is already marked as sent.");
  await audit(sql, admin, "message.hand_sent", "outbound_queue", String(id));
}

// ---- Message log ------------------------------------------------------------------------

export type LogRow = {
  id: number;
  created_at: Date;
  direction: "in" | "out";
  recipient: string;
  student: string | null;
  kind: string;
  template: string | null;
  category: string | null;
  status: string;
  error: string | null;
  estimated_cost_usd: number | null;
  simulated: boolean;
  summary: string;
};

export async function messageLog(
  sql: Sql,
  filter: { direction?: string; status?: string; q?: string; template?: string; days?: number },
): Promise<LogRow[]> {
  const rows = await sql.query<Omit<LogRow, "summary"> & { body: Record<string, unknown> }>(
    `select l.id::int, l.created_at, l.direction, coalesce(l.phone, l.email) as recipient,
            s.first_name as student, l.kind, l.template, l.category, l.status, l.error,
            l.estimated_cost_usd::float8 as estimated_cost_usd, l.simulated, l.body
     from public.message_log l left join public.students s on s.id = l.student_id
     where ($1::text is null or l.direction = $1)
       and ($2::text is null or l.status = $2)
       and ($3::text is null or coalesce(l.phone, l.email) ilike '%' || $3 || '%')
       and ($4::text is null or l.template = $4)
       and l.created_at >= now() - make_interval(days => $5)
     order by l.id desc
     limit 300`,
    [
      filter.direction ?? null,
      filter.status ?? null,
      filter.q ?? null,
      filter.template ?? null,
      filter.days ?? 7,
    ],
  );
  return rows.map(({ body, ...r }) => ({
    ...r,
    summary: String(body.text ?? body.subject ?? body.name ?? body.replyTitle ?? r.kind).slice(
      0,
      140,
    ),
  }));
}
