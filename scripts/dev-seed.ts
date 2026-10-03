// Creates FAKE development data in the Supabase project from .env.local: a demo parent, a demo
// student with guardian consent, an ambassador, and a sponsor link to try Stripe test checkout.
// Usage: npm run seed:dev   (safe to run again; it reuses what exists)
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { ensureDemoQuestions, ensureReviewer } from "./lib/demo-content.ts";
import {
  DEMO_AMBASSADORS,
  DEMO_PAYERS,
  DEMO_STUDENTS,
  demoBillingEvents,
} from "./lib/demo-people.ts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
if (!url || !secret) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set in .env.local.");
  process.exit(1);
}

const db = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });

function fail(what: string, error: { message: string }): never {
  throw new Error(`${what}: ${error.message}`);
}

const DEMO_EMAIL = "demo-parent@kinprep.test";

// 1. Demo parent (auth user + profile + payer).
const listed = await db.auth.admin.listUsers({ perPage: 1000 });
if (listed.error) fail("list users", listed.error);
let parentId = listed.data.users.find((u) => u.email === DEMO_EMAIL)?.id;
if (!parentId) {
  const created = await db.auth.admin.createUser({ email: DEMO_EMAIL, email_confirm: true });
  if (created.error) fail("create user", created.error);
  parentId = created.data.user.id;
}
const profile = await db.from("profiles").upsert({ id: parentId, role: "payer" });
if (profile.error) fail("profile", profile.error);
const payer = await db.from("payers").upsert({
  id: parentId,
  payer_type: "parent",
  region: "nigeria",
  currency: "NGN",
  timezone: "Africa/Lagos",
});
if (payer.error) fail("payer", payer.error);

// 2. Demo student with consent.
const found = await db
  .from("students")
  .select("id")
  .eq("owner_id", parentId)
  .eq("first_name", "Ada")
  .maybeSingle<{ id: string }>();
if (found.error) fail("find student", found.error);
let studentId = found.data?.id;
if (!studentId) {
  const inserted = await db
    .from("students")
    .insert({
      owner_id: parentId,
      first_name: "Ada",
      last_initial: "O",
      class: "SS2",
      birth_year: new Date().getUTCFullYear() - 16,
      exam: "WASSCE",
      subjects: ["english", "mathematics", "physics", "biology"],
    })
    .select("id")
    .single<{ id: string }>();
  if (inserted.error) fail("create student", inserted.error);
  studentId = inserted.data.id;
  const consent = await db.from("guardian_consents").insert({
    student_id: studentId,
    event: "granted",
    method: "web_checkbox",
    consent_text_version: "dev-seed",
    given_by: parentId,
  });
  if (consent.error) fail("consent", consent.error);
}

// 3. Ambassadors to try referral codes and payouts with (DEMO10 in Nigeria, DEMOUK in the UK).
const ambassadorIds: Record<string, string> = {};
for (const a of DEMO_AMBASSADORS) {
  const saved = await db
    .from("ambassadors")
    .upsert(
      {
        name: a.name,
        code: a.code,
        payout_country: a.payoutCountry,
        payout_method: a.payoutMethod,
      },
      { onConflict: "code" },
    )
    .select("id")
    .single<{ id: string }>();
  if (saved.error) fail("ambassador", saved.error);
  ambassadorIds[a.code] = saved.data.id;
}

// 4. Sponsor link.
const link = await db
  .from("sponsor_links")
  .select("code")
  .eq("student_id", studentId)
  .is("revoked_at", null)
  .maybeSingle<{ code: string }>();
if (link.error) fail("find link", link.error);
let code = link.data?.code;
if (!code) {
  code = randomBytes(16).toString("base64url");
  const created = await db.from("sponsor_links").insert({ code, student_id: studentId });
  if (created.error) fail("create link", created.error);
}

console.log(`Student id:   ${studentId}`);
console.log(`Sponsor link: ${appUrl}/sponsor/${code}`);
console.log("Referral code to try: DEMO10. Stripe test card: 4242 4242 4242 4242.");

// 5. The demo people (scripts/lib/demo-people.ts), shared with the scheduled-jobs tests: the
// WhatsApp household (Ada and Chidi), a lapsed plan (Emeka), a junior (Kemi), and a sponsor in
// London on email (Tunde), with their recent practice. Fake numbers no real phone uses.
const questions = await ensureDemoQuestions(db, await ensureReviewer(db));
const practiceSet = [
  ...(questions.get("english:Concord") ?? []),
  ...(questions.get("mathematics:Algebra") ?? []),
]
  .slice(0, 5)
  .map((q) => q.id);
const keys = await db.from("questions").select("id, answer_index").in("id", practiceSet);
if (keys.error) fail("answer keys", keys.error);
const answerOf = new Map(
  (keys.data as { id: string; answer_index: number }[]).map((q) => [q.id, q.answer_index]),
);
const lagosDayOf = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(d);
const today = lagosDayOf(new Date());
const daysBefore = (n: number) => lagosDayOf(new Date(Date.now() - n * 86_400_000));

const payerIds: Record<string, string> = {};
for (const p of DEMO_PAYERS) {
  let id = listed.data.users.find((u) => u.email === p.email)?.id;
  if (p.key === "parent") id = parentId;
  if (!id) {
    const created = await db.auth.admin.createUser({ email: p.email, email_confirm: true });
    if (created.error) fail("create payer", created.error);
    id = created.data.user.id;
  }
  payerIds[p.key] = id;
  const prof = await db.from("profiles").upsert({ id, role: "payer" });
  if (prof.error) fail("payer profile", prof.error);
  const row = await db.from("payers").upsert({
    id,
    payer_type: p.payerType,
    region: p.region,
    currency: p.currency,
    timezone: p.timezone,
    whatsapp_number: p.whatsapp,
    whatsapp_reports_opt_in_at: p.whatsappOptIn ? new Date().toISOString() : null,
    report_weekday: p.reportWeekday,
    report_hour: p.reportHour,
  });
  if (row.error) fail("payer", row.error);
}

const currentYear = new Date().getUTCFullYear();
for (const s of DEMO_STUDENTS) {
  const owner = payerIds[s.owner]!;
  const fields = {
    class: s.class,
    birth_year: s.junior ? currentYear - 11 : currentYear - 16,
    exam: s.junior ? "BECE" : "WASSCE",
    whatsapp_number: s.whatsapp,
    whatsapp_opt_in_at: s.dailyMessages ? new Date().toISOString() : null,
  };
  const found = await db
    .from("students")
    .select("id")
    .eq("owner_id", owner)
    .eq("first_name", s.firstName)
    .maybeSingle<{ id: string }>();
  if (found.error) fail("find student", found.error);
  let id = found.data?.id;
  if (id) {
    const updated = await db.from("students").update(fields).eq("id", id);
    if (updated.error) fail("update student", updated.error);
  } else {
    const inserted = await db
      .from("students")
      .insert({
        ...fields,
        owner_id: owner,
        first_name: s.firstName,
        last_initial: "O",
        subjects: ["english", "mathematics", "physics", "biology"],
        created_at: new Date(Date.now() - s.addedDaysAgo * 86_400_000).toISOString(),
      })
      .select("id")
      .single<{ id: string }>();
    if (inserted.error) fail("create student", inserted.error);
    id = inserted.data.id;
    const consent = await db.from("guardian_consents").insert({
      student_id: id,
      event: "granted",
      method: "web_checkbox",
      consent_text_version: "dev-seed",
      given_by: owner,
    });
    if (consent.error) fail("consent", consent.error);
  }
  // Trials (one per student: a re-run is a no-op, so it lapses 7 days after the first seed) and
  // paid plans with their past bank-transfer payments, some referred by an ambassador.
  for (const event of demoBillingEvents(s, id, ambassadorIds, new Date())) {
    const applied = await db.rpc("apply_billing_event", { p: event });
    if (applied.error) fail("billing", applied.error);
  }
  // Recent practice: a set of 5 answers (4 right) at 12:00 Lagos on each practice day.
  for (const daysAgo of s.practisedDaysAgo) {
    const day = daysAgo === 0 ? today : daysBefore(daysAgo);
    const existing = await db
      .from("practice_sessions")
      .select("id")
      .eq("student_id", id)
      .eq("channel", "web")
      .eq("lagos_day", day)
      .maybeSingle();
    if (existing.error) fail("find session", existing.error);
    if (existing.data || practiceSet.length < 5) continue;
    const at = new Date(`${day}T12:00:00+01:00`);
    const session = await db
      .from("practice_sessions")
      .insert({
        student_id: id,
        channel: "web",
        started_at: at.toISOString(),
        lagos_day: day,
        question_ids: practiceSet,
        position: 4,
        awaiting: "next",
        completed_at: at.toISOString(),
      })
      .select("id")
      .single<{ id: string }>();
    if (session.error) fail("session", session.error);
    const answers = await db.from("answers").insert(
      practiceSet.map((questionId, i) => ({
        session_id: session.data.id,
        student_id: id,
        question_id: questionId,
        chosen_index: i === 4 ? (answerOf.get(questionId)! + 1) % 4 : answerOf.get(questionId)!,
        correct: i !== 4,
        answered_at: new Date(at.getTime() + i * 60_000).toISOString(),
      })),
    );
    if (answers.error) fail("answers", answers.error);
  }
}

console.log("");
console.log(`WhatsApp simulator: ${appUrl}/admin/dev/whatsapp`);
console.log("  +2348000000001  Ada and Chidi (siblings, free trial; Chidi has missed 2 days)");
console.log("  +2348000000002  Emeka (plan lapsed: gets a sponsor link)");
console.log("  any other number: unknown (gets the free-trial offer)");
console.log("Scheduled jobs, dry run: npm run jobs -- morning --dry-run (see docs/BUILD_PLAN.md)");
console.log("Make yourself admin first: npm run make-admin -- --email you@example.com");
