import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { adminMember, AdminError, type Admin } from "@/lib/admin/common";
import { markSent, pilotQueue, readSettings, saveSettings } from "@/lib/admin/console";
import { overview, pilotMeasures } from "@/lib/admin/metrics";
import {
  confirmBatch,
  getBatch,
  listAmbassadors,
  markPayoutPaid,
  payoutPreview,
  prepareBatch,
  setPayoutDestination,
  type PayoutClients,
} from "@/lib/admin/money";
import { changeClass, mergeStudents, pauseStudent, resumeStudent } from "@/lib/admin/students";
import { getStudentAccess, isStudentActive } from "@/lib/access";
import { prepareManual, runJob } from "@/lib/jobs/jobs";
import { verifyPracticeLink } from "@/lib/practice/links";
import { accessStore } from "@/lib/practice/repo";
import { createTestDb, createUser } from "./db/harness";
import { seedDemoPeople, type DemoIds } from "./db/demo-seed";
import { pgliteSql } from "./db/sql-pglite";

// The admin console's "Done when", with the seed's people (scripts/lib/demo-people.ts): the
// overview numbers match plain SQL, the pilot console makes working wa.me links, and an
// ambassador payout batch can be prepared and confirmed.

const APP = "https://kinprep.test";
const SECRET = "admin-test-practice-link-secret-0123456789";
// Sunday 11 October 2026, 07:30 in Lagos.
const NOW = new Date("2026-10-11T07:30:00+01:00");

let db: PGlite;
let sql: ReturnType<typeof pgliteSql>;
let ids: DemoIds;
let admin: Admin;

const one = async <T>(text: string, params: unknown[] = []) =>
  (await db.query<T>(text, params)).rows[0]!;

beforeAll(async () => {
  db = await createTestDb();
  sql = pgliteSql(db);
  ids = await seedDemoPeople(db, new Date(NOW.getTime() - 3600_000));
  admin = await adminMember(sql, await createUser(db, "admin"));
  await db.query(
    `insert into public.message_log (direction, phone, kind, body, status, template, category, estimated_cost_usd)
     values ('out', '+2348000000001', 'template', '{}', 'sent', 'kinprep_morning_practice', 'utility', 0.0067),
            ('out', '+2348000000009', 'template', '{}', 'sent', 'kinprep_weekly_report', 'utility', 0.0067),
            ('out', '+2348000000009', 'template', '{}', 'failed', 'kinprep_weekly_report', 'utility', 0.0067)`,
  );
  await db.query(
    "insert into public.message_log (direction, email, kind, body, status, category, estimated_cost_usd) values ('out', 'demo-sponsor@kinprep.test', 'email', '{}', 'sent', 'email', 0)",
  );
}, 60_000);

describe("the overview", () => {
  it("matches a plain SQL check, number by number", async () => {
    const o = await overview(sql, NOW);
    const monthStart = "2026-10-01T00:00:00+01:00";

    // Active: consent granted, not paused, and a plan or trial covering now (or in grace).
    const active = await one<{ n: number }>(
      `select count(*)::int as n from public.students s
       where s.paused_at is null
         and (select event from public.guardian_consents g where g.student_id = s.id
              order by created_at desc limit 1) = 'granted'
         and exists (select 1 from public.subscriptions sub where sub.student_id = s.id and (
               (sub.provider = 'trial' and sub.status = 'trialing' and sub.trial_end > $1)
            or (sub.provider <> 'trial' and sub.status in ('active', 'trialing')
                and sub.current_period_end + interval '3 days' > $1)))`,
      [NOW],
    );
    expect(o.activeStudents).toBe(active.n);
    expect(o.activeStudents).toBe(4); // Ada, Chidi (trials), Kemi, Tunde (paid); not Emeka

    const payers = await db.query<{ payer_type: string; n: number }>(
      "select payer_type::text, count(*)::int as n from public.payers group by 1 order by 1",
    );
    expect(o.payersByType).toEqual({
      sponsor: payers.rows.find((r) => r.payer_type === "sponsor")?.n ?? 0,
      parent: payers.rows.find((r) => r.payer_type === "parent")?.n ?? 0,
      group: 0,
    });

    const mrr = await db.query<{ currency: string; mrr: number }>(
      `select currency::text, sum(case plan
                 when 'abroad_monthly' then 600 when 'abroad_yearly' then round(5500 / 12.0)
                 when 'nigeria_monthly' then 200000 when 'nigeria_weekly' then round(50000 * 52 / 12.0)
                 when 'bulk_seat_monthly' then 400 * seats end)::int as mrr
       from public.subscriptions
       where provider <> 'trial' and status = 'active' and current_period_end > $1
       group by currency`,
      [NOW],
    );
    expect(o.mrr).toEqual(Object.fromEntries(mrr.rows.map((r) => [r.currency, r.mrr])));
    expect(o.mrr).toEqual({ GBP: 600, NGN: 200_000 }); // £6.00 and ₦2,000 a month

    const trials = await one<{ started: number; converted: number }>(
      `select count(distinct s.student_id)::int as started,
              count(distinct s.student_id) filter (where p.id is not null)::int as converted
       from public.subscriptions s
       left join public.subscriptions paid on paid.student_id = s.student_id and paid.provider <> 'trial'
       left join public.payments p on p.subscription_id = paid.id and p.status = 'succeeded'
       where s.provider = 'trial'`,
    );
    expect(o.trials).toEqual(trials);

    // Last full week, Monday 28 September to Sunday 4 October: who had 5+ days of 5+ answers.
    const week = await one<{ n: number }>(
      `select count(*)::int as n from (
         select a.student_id from public.answers a
         where a.answered_at >= '2026-09-28T00:00:00+01:00' and a.answered_at < '2026-10-05T00:00:00+01:00'
         group by a.student_id, (a.answered_at at time zone 'Africa/Lagos')::date
         having count(*) >= 5) d`,
    );
    expect(o.practising5Days).toEqual({ students: week.n >= 5 ? 1 : 0, of: 4, week: "2026-09-28" });

    const renewals = await one<{ n: number }>(
      `select count(*)::int as n from public.payments p
       where p.status = 'succeeded' and p.occurred_at >= $1
         and (select count(*) from public.payments e where e.subscription_id = p.subscription_id
              and e.status = 'succeeded' and e.occurred_at < p.occurred_at) > 0`,
      [monthStart],
    );
    expect(o.renewalsThisMonth).toBe(renewals.n);
    expect(o.renewalsThisMonth).toBe(1); // Kemi's second month

    const canceled = await one<{ n: number }>(
      "select count(*)::int as n from public.subscriptions where provider <> 'trial' and canceled_at >= $1",
      [monthStart],
    );
    expect(o.churn.canceled).toBe(canceled.n);
    expect(o.churn.canceled).toBe(1); // Emeka

    const sent = await one<{ whatsapp: number; email: number; cost: number }>(
      `select count(phone)::int as whatsapp, count(email)::int as email,
              sum(estimated_cost_usd)::float8 as cost
       from public.message_log where direction = 'out' and status in ('sent', 'simulated')`,
    );
    expect(o.messages).toEqual({ whatsapp: sent.whatsapp, email: sent.email, costUsd: sent.cost });
    expect(o.messages).toEqual({ whatsapp: 2, email: 1, costUsd: 0.0134 });
  });

  it("shows each pilot measure against its go and stop lines", async () => {
    const rows = await pilotMeasures(sql, NOW);
    const byKey = Object.fromEntries(rows.map((r) => [r.measure.key, r]));
    expect(byKey.sponsors_paying).toMatchObject({ value: 1, status: "stop" }); // go 10, stop below 3
    expect(byKey.parents_paying).toMatchObject({ value: 1, status: "stop" }); // go 20, stop below 5
    expect(byKey.students_5_days).toMatchObject({ value: 0, status: "stop" });
    expect(byKey.ambassador_payers!.value).toBe(2); // the parent (Kemi) and the sponsor (Tunde)
    expect(byKey.bulk_enquiries).toMatchObject({ value: 0, status: "watch" }); // no stop line
    expect(rows).toHaveLength(6);
  });
});

describe("the pilot console", () => {
  const ctx = () => ({ sql, now: NOW, dryRun: false, appUrl: APP, practiceSecret: SECRET });

  it("makes today's practice links with working wa.me links, once", async () => {
    const made = await prepareManual("practice-links", ctx());
    expect(made.planned.map((p) => [p.to, p.about])).toEqual([
      ["+2348000000001", "Ada"],
      ["+2348000000001", "Chidi"],
      ["+2348000000009", "Kemi (to parent)"],
      ["+2348000000003", "Tunde"],
    ]);
    expect((await prepareManual("practice-links", ctx())).planned.every((p) => !p.queued)).toBe(
      true,
    );

    const queue = await pilotQueue(sql, NOW);
    const kemi = queue.find((q) => q.about === "Kemi")!;
    const link = new URL(kemi.link);
    expect(link.origin + link.pathname).toBe("https://wa.me/2348000000009");
    const text = link.searchParams.get("text")!;
    expect(text).toContain("hand it to Kemi");
    const token = text.match(/\/p\/([\w-]{52})/)![1]!;
    expect(verifyPracticeLink(token, SECRET, NOW)).toMatchObject({
      ok: true,
      studentId: ids.students.Kemi,
    });
  });

  it("does the same for Sunday reports and missed-day alerts, and marks each as sent", async () => {
    await prepareManual("weekly-reports", ctx());
    await prepareManual("missed-days", { ...ctx(), now: new Date("2026-10-11T21:00:00+01:00") });
    const queue = await pilotQueue(sql, NOW);
    const reports = queue.filter((q) => q.job === "weekly_report");
    expect(reports.map((q) => q.about).sort()).toEqual(["Ada", "Chidi", "Kemi", "Tunde"]);
    const report = reports.find((q) => q.about === "Ada")!;
    // The template's button becomes a line of its own in a hand-sent message.
    expect(report.text).toMatch(
      /\n\nFull report: https:\/\/kinprep.test\/app\/children\/[\w-]+\/report$/,
    );
    // Tunde's sponsor isn't on WhatsApp: a mailto link instead.
    expect(reports.find((q) => q.about === "Tunde")!.link).toMatch(
      /^mailto:demo-sponsor@kinprep.test\?/,
    );
    const alert = queue.find((q) => q.job === "missed_days")!;
    expect(alert).toMatchObject({ about: "Chidi", recipient: "+2348000000009" });

    await markSent(sql, admin, alert.id, NOW);
    await expect(markSent(sql, admin, alert.id, NOW)).rejects.toThrow(/already/);
    const after = (await pilotQueue(sql, NOW)).find((q) => q.id === alert.id)!;
    expect(after.status).toBe("sent");
    // The scheduled job won't send it again once the Cloud API is live.
    const live = await runJob("missed-days", {
      ...ctx(),
      now: new Date("2026-10-11T21:00:00+01:00"),
    });
    expect(live.planned.filter((p) => p.queued)).toEqual([]);
    const { rows } = await db.query(
      "select 1 from public.audit_log where action = 'message.hand_sent' and actor_id = $1",
      [admin.id],
    );
    expect(rows).toHaveLength(1);
  });
});

describe("ambassador payouts", () => {
  function fakeClients(): PayoutClients & { calls: unknown[] } {
    const calls: unknown[] = [];
    return {
      calls,
      async paystackTransfer(t) {
        calls.push(["paystack", t]);
        return { status: "paid", ref: `TRF_${t.reference.slice(0, 8)}` };
      },
      async stripeTransfer(t) {
        calls.push(["stripe", t]);
        return { ref: `tr_${t.idempotencyKey.slice(0, 8)}` };
      },
    };
  }

  it("lists referrals and 20% of each referred payer's first three months", async () => {
    const ambassadors = await listAmbassadors(sql, NOW);
    const ng = ambassadors.find((a) => a.code === "DEMO10")!;
    const uk = ambassadors.find((a) => a.code === "DEMOUK")!;
    expect(ng).toMatchObject({ referred_payers: 1, earned: { NGN: 80_000 }, paid: {} }); // 20% of 2 x ₦2,000
    expect(uk).toMatchObject({ referred_payers: 1, earned: { GBP: 120 }, paid: {} }); // 20% of £6
  });

  it("prepares a monthly batch, then pays it on confirmation, once", async () => {
    await setPayoutDestination(sql, admin, ids.ambassadors.DEMO10!, {
      kind: "paystack",
      recipientCode: "RCP_demo10",
      bankName: "GTBank",
      accountLast4: "1234",
    });
    await setPayoutDestination(sql, admin, ids.ambassadors.DEMOUK!, {
      kind: "stripe_connect",
      accountId: "acct_demouk",
    });
    // September: only Kemi's first payment (1 September) is in it.
    expect(await payoutPreview(sql, "2026-09")).toEqual([
      expect.objectContaining({ currency: "NGN", amountMinor: 40_000 }),
    ]);
    const batchId = await prepareBatch(sql, admin, "2026-10");
    await expect(prepareBatch(sql, admin, "2026-10")).rejects.toThrow(/Confirm or discard/);
    const batch = (await getBatch(sql, batchId))!;
    expect(
      batch.payouts.map((p) => [p.code, p.currency, p.amount_minor, p.method, p.status]),
    ).toEqual([
      ["DEMO10", "NGN", 80_000, "paystack", "prepared"],
      ["DEMOUK", "GBP", 120, "stripe_connect", "prepared"],
    ]);

    const clients = fakeClients();
    expect(await confirmBatch(sql, admin, batchId, clients)).toEqual({
      paid: 2,
      sending: 0,
      manual: 0,
      failed: 0,
    });
    expect(clients.calls).toEqual([
      ["paystack", expect.objectContaining({ amountMinor: 80_000, recipientCode: "RCP_demo10" })],
      [
        "stripe",
        expect.objectContaining({ amountMinor: 120, currency: "GBP", accountId: "acct_demouk" }),
      ],
    ]);
    await expect(confirmBatch(sql, admin, batchId, clients)).rejects.toThrow(/already/);
    expect((await getBatch(sql, batchId))!.payouts.every((p) => p.status === "paid")).toBe(true);
    // Nothing left to pay: the same payments can't be batched again.
    expect(await payoutPreview(sql, "2026-10")).toEqual([]);
    await expect(prepareBatch(sql, admin, "2026-10")).rejects.toThrow(/No commission/);
    const uk = (await listAmbassadors(sql, NOW)).find((a) => a.code === "DEMOUK")!;
    expect(uk.paid).toEqual({ GBP: 120 });
  });

  it("leaves manual payouts for 'mark as paid', and records a failed transfer without stopping", async () => {
    // A new payment referred by a manual-payout ambassador and one whose transfer fails.
    const [manualAmb] = (
      await db.query<{ id: string }>(
        "insert into public.ambassadors (name, code, payout_country, payout_method) values ('Hand Paid', 'HANDPAY', 'NG', 'manual') returning id::text",
      )
    ).rows;
    for (const [ambassador, ref] of [
      [manualAmb!.id, "NEW-1"],
      [ids.ambassadors.DEMO10!, "NEW-2"],
    ] as const) {
      const { rows: s } = await db.query<{ id: string }>(
        `insert into public.subscriptions (provider, provider_subscription_id, student_id, plan, currency, status, ambassador_id)
         values ('manual', $3, $1, 'nigeria_monthly', 'NGN', 'active', $2) returning id::text`,
        [ids.students.Ada, ambassador, `sub-${ref}`],
      );
      await db.query(
        `insert into public.payments (provider, provider_payment_id, subscription_id, status, amount_minor, currency, occurred_at, ambassador_id)
         values ('manual', $1, $2, 'succeeded', 200000, 'NGN', $3, $4)`,
        [ref, s[0]!.id, NOW, ambassador],
      );
    }
    const batchId = await prepareBatch(sql, admin, "2026-10");
    const failing: PayoutClients = {
      paystackTransfer: async () => {
        throw new Error("Insufficient balance");
      },
      stripeTransfer: async () => ({ ref: "tr_x" }),
    };
    expect(await confirmBatch(sql, admin, batchId, failing)).toEqual({
      paid: 0,
      sending: 0,
      manual: 1,
      failed: 1,
    });
    const batch = (await getBatch(sql, batchId))!;
    const manual = batch.payouts.find((p) => p.method === "manual")!;
    expect(batch.payouts.find((p) => p.method === "paystack")).toMatchObject({
      status: "failed",
      error: "Insufficient balance",
    });
    await expect(markPayoutPaid(sql, admin, manual.id, "")).rejects.toThrow(/reference/);
    await markPayoutPaid(sql, admin, manual.id, "GTB-998877");
    expect((await getBatch(sql, batchId))!.payouts.find((p) => p.id === manual.id)!.status).toBe(
      "paid",
    );
  });
});

describe("students", () => {
  it("pauses and resumes: isStudentActive says no while paused", async () => {
    const ada = ids.students.Ada!;
    const store = accessStore(sql);
    await pauseStudent(sql, admin, ada, "Family holiday", NOW);
    expect(await isStudentActive(ada, { now: NOW, store })).toBe(false);
    expect(await getStudentAccess(ada, { now: NOW, store })).toMatchObject({ paused: true });
    await expect(pauseStudent(sql, admin, ada, "again", NOW)).rejects.toThrow(/already paused/);
    await resumeStudent(sql, admin, ada);
    expect(await isStudentActive(ada, { now: NOW, store })).toBe(true);
  });

  it("changes class within JSS or SS only", async () => {
    await changeClass(sql, admin, ids.students.Ada!, "SS3", NOW);
    expect(
      (
        await one<{ class: string }>("select class::text from public.students where id = $1", [
          ids.students.Ada,
        ])
      ).class,
    ).toBe("SS3");
    await expect(changeClass(sql, admin, ids.students.Kemi!, "SS1", NOW)).rejects.toThrow(
      /JSS and SS/,
    );
    await expect(changeClass(sql, admin, ids.students.Ada!, "UTME", NOW)).rejects.toThrow(/UTME/);
  });

  it("merges a duplicate into the original, keeping practice and dropping the copy", async () => {
    const parent = ids.payers.parent!;
    const { rows } = await db.query<{ id: string }>(
      `insert into public.students (owner_id, first_name, last_initial, class, birth_year, exam, subjects)
       select owner_id, first_name, last_initial, class, birth_year, exam, subjects from public.students where id = $1
       returning id::text`,
      [ids.students.Chidi],
    );
    const copy = rows[0]!.id;
    const { rows: session } = await db.query<{ id: string }>(
      "insert into public.practice_sessions (student_id, channel, lagos_day) values ($1, 'web', '2026-09-01') returning id::text",
      [copy],
    );
    await expect(mergeStudents(sql, admin, copy, ids.students.Tunde!)).rejects.toThrow(
      /same payer/,
    );
    await expect(mergeStudents(sql, admin, copy, ids.students.Kemi!)).rejects.toThrow(
      /live paid plan/,
    );
    expect(await mergeStudents(sql, admin, ids.students.Chidi!, copy)).toEqual({
      sessionsMoved: 1,
      sessionsDropped: 0,
    });
    expect(
      (
        await one<{ student_id: string }>(
          "select student_id::text from public.practice_sessions where id = $1",
          [session[0]!.id],
        )
      ).student_id,
    ).toBe(ids.students.Chidi);
    expect(
      (await db.query("select 1 from public.students where id = $1", [copy])).rows,
    ).toHaveLength(0);
    void parent;
  });

  it("only admins can do any of it", async () => {
    const reviewer = await createUser(db, "reviewer");
    await expect(adminMember(sql, reviewer)).rejects.toThrow(AdminError);
  });
});

describe("settings", () => {
  it("saves questions per day, the reminder, the streak, prices and grace days, with an audit entry", async () => {
    const before = await readSettings(sql);
    expect(before).toMatchObject({
      questionsPerDay: 10,
      reminderEnabled: false,
      streakThreshold: 5,
    });
    expect(before.billing.graceDays).toBe(3);
    await saveSettings(sql, admin, {
      questionsPerDay: 12,
      reminderEnabled: true,
      streakThreshold: 6,
      graceDays: 5,
      waPerSecond: 5,
      waPerDay: 500,
      aiPerDay: 3,
      prices: { nigeria_weekly: { NGN: 600 }, abroad_monthly: { GBP: 6, USD: 9 } },
    });
    const after = await readSettings(sql);
    expect(after).toMatchObject({
      questionsPerDay: 12,
      reminderEnabled: true,
      streakThreshold: 6,
      waPerSecond: 5,
      waPerDay: 500,
      aiPerDay: 3,
    });
    expect(after.billing.graceDays).toBe(5);
    expect(after.billing.prices.nigeria_weekly.NGN).toBe(60_000);
    expect(after.billing.prices.abroad_monthly).toMatchObject({ GBP: 600, USD: 900 });
    // Grace days now apply to access: a lapsed paid plan stays in grace for 5 days, not 3.
    const store = accessStore(sql);
    expect((await store.billingSettings()).graceDays).toBe(5);
    await expect(
      saveSettings(sql, admin, { ...after, graceDays: 5, streakThreshold: 13, prices: {} }),
    ).rejects.toThrow(/streak threshold/);
    const { rows } = await db.query<{ details: { after: Record<string, unknown> } }>(
      "select details from public.audit_log where action = 'settings.updated' order by id desc limit 1",
    );
    expect(rows[0]!.details.after).toMatchObject({
      questions_per_day: 12,
      price_overrides: { nigeria_weekly: { NGN: 60_000 }, abroad_monthly: { USD: 900 } },
    });
  });
});
