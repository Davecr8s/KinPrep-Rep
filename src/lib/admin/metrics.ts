import { GO_STOP_MEASURES, type GoStopMeasure } from "@/config/pilot";
import type { Currency } from "@/config/pricing";
import { getStudentAccess } from "@/lib/access";
import type { Sql } from "@/lib/db/sql";
import { streakThreshold } from "@/lib/engine";
import { accessStore } from "@/lib/practice/repo";
import { addDays, lagosDay, lagosDayStart, weekStart } from "@/lib/rules/days";
import {
  measureStatus,
  monthBounds,
  monthlyEquivalent,
  monthOf,
  type MeasureStatus,
} from "./rules";

// The admin overview and the pilot's go/stop measures. Every number is defined here in words so
// it can be checked by hand (test/admin.test.ts checks each against plain SQL).

export type Overview = {
  /** Students isStudentActive says yes to now (consent, not paused, a plan or trial or seat). */
  activeStudents: number;
  /** Payer accounts by type (sponsor abroad, parent in Nigeria, group buyer). */
  payersByType: Record<"sponsor" | "parent" | "group", number>;
  /** Paid subscriptions active now, per month, per currency (minor units). Trials excluded. */
  mrr: Partial<Record<Currency, number>>;
  /** Students who had a free trial, and how many of those then paid. */
  trials: { started: number; converted: number };
  /** Active students with 5+ practice days (streak threshold answers) last Monday-Sunday. */
  practising5Days: { students: number; of: number; week: string };
  /** Successful payments this month on a subscription that had been paid for before. */
  renewalsThisMonth: number;
  /** Paid subscriptions cancelled this month, and the active paid ones at the start of it. */
  churn: { canceled: number; atStart: number };
  /** WhatsApp messages sent this month, emails sent, and the estimated WhatsApp cost (USD). */
  messages: { whatsapp: number; email: number; costUsd: number };
  month: string;
};

const PAID = "provider in ('stripe', 'paystack', 'manual')";

export async function activeStudentIds(sql: Sql, now: Date): Promise<string[]> {
  const students = await sql.query<{ id: string }>("select id::text from public.students");
  const store = accessStore(sql);
  const active: string[] = [];
  for (const s of students) {
    const access = await getStudentAccess(s.id, { now, store });
    if (access.state !== "inactive") active.push(s.id);
  }
  return active;
}

export async function overview(sql: Sql, now: Date): Promise<Overview> {
  const today = lagosDay(now);
  const month = monthOf(today);
  const { start, next } = monthBounds(month);
  const monthStart = lagosDayStart(start);
  const monthEnd = lagosDayStart(next);
  const active = await activeStudentIds(sql, now);

  const payers = await sql.query<{ payer_type: "sponsor" | "parent" | "group"; n: number }>(
    "select payer_type::text, count(*)::int as n from public.payers group by payer_type",
  );
  const [groupBuyers] = await sql.query<{ n: number }>(
    "select count(*)::int as n from public.profiles where role = 'group_buyer'",
  );
  const payersByType = { sponsor: 0, parent: 0, group: groupBuyers!.n };
  for (const p of payers) payersByType[p.payer_type] += p.n;

  const store = accessStore(sql);
  const billing = await store.billingSettings();
  const subs = await sql.query<{ plan: string; currency: Currency; seats: number | null }>(
    `select plan, currency::text, seats from public.subscriptions
     where ${PAID} and status = 'active' and current_period_end > $1`,
    [now],
  );
  const mrr: Partial<Record<Currency, number>> = {};
  for (const s of subs) {
    mrr[s.currency] =
      (mrr[s.currency] ?? 0) + monthlyEquivalent(s.plan, s.currency, s.seats, billing.prices);
  }

  const [trials] = await sql.query<{ started: number; converted: number }>(
    `with trialled as (
       select distinct student_id from public.subscriptions
       where student_id is not null and (provider = 'trial' or trial_end is not null)
     )
     select count(*)::int as started,
            (count(*) filter (where exists (
               select 1 from public.payments p join public.subscriptions s on s.id = p.subscription_id
               where s.student_id = t.student_id and p.status = 'succeeded' and p.provider <> 'trial'
            )))::int as converted
     from trialled t`,
  );

  // Last full Monday-Sunday week, Lagos.
  const lastMonday = addDays(weekStart(today), -7);
  const threshold = await streakThreshold(sql);
  const days = await sql.query<{ student_id: string; days: number }>(
    `select student_id::text, count(*)::int as days from (
       select student_id, (answered_at at time zone 'Africa/Lagos')::date as day
       from public.answers where answered_at >= $1 and answered_at < $2
       group by student_id, day having count(*) >= $3
     ) d group by student_id`,
    [lagosDayStart(lastMonday), lagosDayStart(addDays(lastMonday, 7)), threshold],
  );
  const practising = active.filter((id) => (days.find((d) => d.student_id === id)?.days ?? 0) >= 5);

  const [renewals] = await sql.query<{ n: number }>(
    `select count(*)::int as n from public.payments p
     where p.status = 'succeeded' and p.provider <> 'trial'
       and p.occurred_at >= $1 and p.occurred_at < $2
       and exists (select 1 from public.payments e where e.subscription_id = p.subscription_id
                   and e.status = 'succeeded' and e.occurred_at < p.occurred_at)`,
    [monthStart, monthEnd],
  );
  const [churn] = await sql.query<{ canceled: number; at_start: number }>(
    `select (count(*) filter (where canceled_at >= $1 and canceled_at < $2))::int as canceled,
            (count(*) filter (where created_at < $1 and (canceled_at is null or canceled_at >= $1)
                              and coalesce(current_period_end, $1) >= $1))::int as at_start
     from public.subscriptions where ${PAID}`,
    [monthStart, monthEnd],
  );
  const [messages] = await sql.query<{ whatsapp: number; email: number; cost: number }>(
    `select (count(*) filter (where phone is not null))::int as whatsapp,
            (count(*) filter (where email is not null))::int as email,
            coalesce(sum(estimated_cost_usd), 0)::float8 as cost
     from public.message_log
     where direction = 'out' and status in ('sent', 'simulated') and created_at >= $1 and created_at < $2`,
    [monthStart, monthEnd],
  );

  return {
    activeStudents: active.length,
    payersByType,
    mrr,
    trials: { started: trials!.started, converted: trials!.converted },
    practising5Days: { students: practising.length, of: active.length, week: lastMonday },
    renewalsThisMonth: renewals!.n,
    churn: { canceled: churn!.canceled, atStart: churn!.at_start },
    messages: {
      whatsapp: messages!.whatsapp,
      email: messages!.email,
      costUsd: Math.round(Number(messages!.cost) * 10_000) / 10_000,
    },
    month,
  };
}

export type MeasureRow = {
  measure: GoStopMeasure;
  value: number;
  status: MeasureStatus;
  /** How the value was worked out, in words. */
  how: string;
};

/** Each go/stop measure from the brief, worked out from live data. */
export async function pilotMeasures(sql: Sql, now: Date, ov?: Overview): Promise<MeasureRow[]> {
  const o = ov ?? (await overview(sql, now));
  const payingBy = async (type: "sponsor" | "parent") => {
    const [row] = await sql.query<{ n: number }>(
      `select count(distinct p.id)::int as n
       from public.subscriptions s
       left join public.students st on st.id = s.student_id
       join public.payers p on p.id = coalesce(s.payer_id, st.owner_id)
       where s.${PAID} and s.status = 'active' and s.current_period_end > $1 and p.payer_type = $2`,
      [now, type],
    );
    return row!.n;
  };
  const [renewal] = await sql.query<{ eligible: number; renewed: number }>(
    `with firsts as (
       select subscription_id, min(occurred_at) as first_paid, count(*) as payments
       from public.payments where status = 'succeeded' and provider <> 'trial' and subscription_id is not null
       group by subscription_id
     )
     select count(*)::int as eligible, (count(*) filter (where payments > 1))::int as renewed
     from firsts where first_paid <= $1`,
    [new Date(now.getTime() - 28 * 86_400_000)],
  );
  const [groups] = await sql.query<{ n: number }>(
    "select count(*)::int as n from public.group_accounts",
  );
  const [referred] = await sql.query<{ n: number }>(
    `select count(distinct coalesce(s.payer_id, st.owner_id))::int as n
     from public.payments p join public.subscriptions s on s.id = p.subscription_id
     left join public.students st on st.id = s.student_id
     where p.status = 'succeeded' and p.ambassador_id is not null`,
  );
  const pct = (a: number, b: number) => (b === 0 ? 0 : Math.round((a / b) * 100));
  const values: Record<string, { value: number; how: string }> = {
    sponsors_paying: { value: await payingBy("sponsor"), how: "sponsors with an active paid plan" },
    parents_paying: { value: await payingBy("parent"), how: "parents with an active paid plan" },
    students_5_days: {
      value: pct(o.practising5Days.students, o.practising5Days.of),
      how: `${o.practising5Days.students} of ${o.practising5Days.of} active students, week of ${o.practising5Days.week}`,
    },
    renewals_after_week_4: {
      value: pct(renewal!.renewed, renewal!.eligible),
      how: `${renewal!.renewed} of ${renewal!.eligible} subscriptions first paid 4+ weeks ago paid again`,
    },
    bulk_enquiries: { value: groups!.n, how: "group accounts created (schools, churches, alumni)" },
    ambassador_payers: { value: referred!.n, how: "paying payers who came through an ambassador" },
  };
  return GO_STOP_MEASURES.map((measure) => {
    const v = values[measure.key]!;
    return { measure, value: v.value, status: measureStatus(measure, v.value), how: v.how };
  });
}
