// FAKE demo people, shared by the dev seed (scripts/dev-seed.ts, Supabase) and the scheduled-jobs
// tests (test/jobs.test.ts, PGlite), so `npm run jobs -- <job> --dry-run` against the seed and the
// tests show the same cases. Phone numbers are in a range no real phone uses.
// No imports: Node runs the seed script directly.

export type DemoPayer = {
  key: "parent" | "sponsor";
  email: string;
  region: "nigeria" | "abroad";
  currency: "NGN" | "GBP";
  timezone: string;
  payerType: "parent" | "sponsor";
  /** Payer's WhatsApp number and whether they opted in to KinPrep messages there. */
  whatsapp: string | null;
  whatsappOptIn: boolean;
  /** Weekly report time in their own timezone (0 = Sunday, 6 = Saturday). */
  reportWeekday: number;
  reportHour: number;
};

export type DemoAmbassador = {
  code: "DEMO10" | "DEMOUK";
  name: string;
  payoutCountry: "NG" | "GB";
  payoutMethod: "paystack" | "stripe_connect" | "manual";
};

/** Fake ambassadors: payout destinations are filled in from /admin/ambassadors. */
export const DEMO_AMBASSADORS: DemoAmbassador[] = [
  { code: "DEMO10", name: "Demo Ambassador", payoutCountry: "NG", payoutMethod: "paystack" },
  {
    code: "DEMOUK",
    name: "Demo UK Ambassador",
    payoutCountry: "GB",
    payoutMethod: "stripe_connect",
  },
];

export type DemoStudent = {
  firstName: string;
  class: "JSS1" | "SS1" | "SS2" | "SS3";
  junior: boolean;
  whatsapp: string | null;
  /** Opted in to the morning WhatsApp message (and reminder). */
  dailyMessages: boolean;
  /**
   * "trial": 7-day free trial from seeding; "none": no plan; "paid": bank-transfer (Manual)
   * payments on these days ago, each covering one period, optionally referred by an ambassador
   * and cancelled some days ago.
   */
  plan: "trial" | "none" | "paid";
  paid?: {
    plan: "nigeria_weekly" | "nigeria_monthly" | "abroad_monthly";
    currency: "NGN" | "GBP";
    amountMinor: number;
    paymentsDaysAgo: number[];
    ambassador?: DemoAmbassador["code"];
    canceledDaysAgo?: number;
  };
  owner: DemoPayer["key"];
  /** Added this many days before seeding (missed-days only counts days since then). */
  addedDaysAgo: number;
  /** Days ago with a practice set of 5 answers (0 = today, before the evening jobs). */
  practisedDaysAgo: number[];
};

export const DEMO_PAYERS: DemoPayer[] = [
  {
    key: "parent",
    email: "demo-parent@kinprep.test",
    region: "nigeria",
    currency: "NGN",
    timezone: "Africa/Lagos",
    payerType: "parent",
    whatsapp: "+2348000000009",
    whatsappOptIn: true,
    reportWeekday: 0,
    reportHour: 18,
  },
  {
    key: "sponsor",
    email: "demo-sponsor@kinprep.test",
    region: "abroad",
    currency: "GBP",
    timezone: "Europe/London",
    payerType: "sponsor",
    whatsapp: null,
    whatsappOptIn: false,
    reportWeekday: 6,
    reportHour: 19,
  },
];

export const DEMO_STUDENTS: DemoStudent[] = [
  {
    // Siblings on one household number: Ada practised today, Chidi has stopped.
    firstName: "Ada",
    class: "SS2",
    junior: false,
    whatsapp: "+2348000000001",
    dailyMessages: true,
    plan: "trial",
    owner: "parent",
    addedDaysAgo: 6,
    practisedDaysAgo: [0, 1, 2, 4],
  },
  {
    firstName: "Chidi",
    class: "SS3",
    junior: false,
    whatsapp: "+2348000000001",
    dailyMessages: true,
    plan: "trial",
    owner: "parent",
    addedDaysAgo: 6,
    practisedDaysAgo: [2, 3, 4],
  },
  {
    // Paid weekly once, then cancelled: plan lapsed, no messages.
    firstName: "Emeka",
    class: "SS1",
    junior: false,
    whatsapp: "+2348000000002",
    dailyMessages: true,
    plan: "paid",
    paid: {
      plan: "nigeria_weekly",
      currency: "NGN",
      amountMinor: 50_000,
      paymentsDaysAgo: [20],
      canceledDaysAgo: 2,
    },
    owner: "parent",
    addedDaysAgo: 6,
    practisedDaysAgo: [],
  },
  {
    // Junior: practises on the web from the parent's phone; the link goes to the parent.
    firstName: "Kemi",
    class: "JSS1",
    junior: true,
    whatsapp: null,
    dailyMessages: false,
    plan: "paid",
    paid: {
      plan: "nigeria_monthly",
      currency: "NGN",
      amountMinor: 200_000,
      paymentsDaysAgo: [40, 9],
      ambassador: "DEMO10",
    },
    owner: "parent",
    addedDaysAgo: 6,
    practisedDaysAgo: [1, 2],
  },
  {
    // A sponsor abroad, not on WhatsApp (email). Tunde hasn't opted in to morning messages.
    firstName: "Tunde",
    class: "SS2",
    junior: false,
    whatsapp: "+2348000000003",
    dailyMessages: false,
    plan: "paid",
    paid: {
      plan: "abroad_monthly",
      currency: "GBP",
      amountMinor: 600,
      paymentsDaysAgo: [10],
      ambassador: "DEMOUK",
    },
    owner: "sponsor",
    addedDaysAgo: 6,
    practisedDaysAgo: [0, 1, 3],
  },
];

/**
 * The billing events (for public.apply_billing_event) that give a demo student their plan, as of
 * `now`. Shared by both seeds so they hold the same payments.
 */
export function demoBillingEvents(
  s: DemoStudent,
  studentId: string,
  ambassadorIds: Record<string, string>,
  now: Date,
): Record<string, unknown>[] {
  const day = 86_400_000;
  const daysAgo = (n: number) => new Date(now.getTime() - n * day);
  if (s.plan === "trial") {
    const trialEnd = new Date(now.getTime() + 7 * day).toISOString();
    return [
      {
        provider: "trial",
        event_id: `trial:${studentId}`,
        event_type: "trial.started",
        occurred_at: now.toISOString(),
        payload: { student_id: studentId },
        subscription: {
          student_id: studentId,
          plan: "nigeria_weekly",
          currency: "NGN",
          status: "trialing",
          trial_end: trialEnd,
          current_period_end: trialEnd,
        },
      },
    ];
  }
  if (s.plan !== "paid" || !s.paid) return [];
  const p = s.paid;
  const period = p.plan === "nigeria_weekly" ? 7 : 30;
  const ambassador = p.ambassador ? ambassadorIds[p.ambassador] : undefined;
  const events: Record<string, unknown>[] = p.paymentsDaysAgo.map((ago, i) => {
    const at = daysAgo(ago);
    const reference = `DEMO-${s.firstName.toUpperCase()}-${i + 1}`;
    return {
      provider: "manual",
      event_id: `manual:${reference}`,
      event_type: "manual.payment_recorded",
      occurred_at: at.toISOString(),
      payload: { demo: true },
      subscription: {
        student_id: studentId,
        plan: p.plan,
        currency: p.currency,
        extend: {
          from: at.toISOString(),
          until: new Date(at.getTime() + period * day).toISOString(),
        },
        ...(ambassador ? { ambassador_id: ambassador, referral_code: p.ambassador } : {}),
      },
      payment: {
        provider_payment_id: reference,
        status: "succeeded",
        amount_minor: p.amountMinor,
        currency: p.currency,
        occurred_at: at.toISOString(),
        channel: "manual_transfer",
      },
    };
  });
  if (p.canceledDaysAgo !== undefined) {
    const at = daysAgo(p.canceledDaysAgo).toISOString();
    events.push({
      provider: "manual",
      event_id: `manual:cancel:${studentId}`,
      event_type: "manual.subscription_canceled",
      occurred_at: at,
      payload: { demo: true },
      subscription: {
        student_id: studentId,
        plan: p.plan,
        currency: p.currency,
        status: "canceled",
        canceled_at: at,
      },
    });
  }
  return events;
}
