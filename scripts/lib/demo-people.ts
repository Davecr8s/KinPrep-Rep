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

export type DemoStudent = {
  firstName: string;
  class: "JSS1" | "SS1" | "SS2" | "SS3";
  junior: boolean;
  whatsapp: string | null;
  /** Opted in to the morning WhatsApp message (and reminder). */
  dailyMessages: boolean;
  /** "trial": 7-day free trial from seeding; "none": no plan (practice paused). */
  plan: "trial" | "none";
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
    // Plan lapsed: no messages.
    firstName: "Emeka",
    class: "SS1",
    junior: false,
    whatsapp: "+2348000000002",
    dailyMessages: true,
    plan: "none",
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
    plan: "trial",
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
    plan: "trial",
    owner: "sponsor",
    addedDaysAgo: 6,
    practisedDaysAgo: [0, 1, 3],
  },
];
