// Creates FAKE development data in the Supabase project from .env.local: a demo parent, a demo
// student with guardian consent, an ambassador, and a sponsor link to try Stripe test checkout.
// Usage: npm run seed:dev   (safe to run again; it reuses what exists)
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { ensureDemoQuestions, ensureReviewer } from "./lib/demo-content.ts";

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

// 3. An ambassador to try referral codes with.
const ambassador = await db
  .from("ambassadors")
  .upsert({ name: "Demo Ambassador", code: "DEMO10" }, { onConflict: "code" });
if (ambassador.error) fail("ambassador", ambassador.error);

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

// 5. WhatsApp simulator household (/admin/dev/whatsapp): two siblings on one number, both on the
// free trial, plus a student whose plan has lapsed. Fake numbers in a range no real phone uses.
const HOUSE = "+2348000000001";
const LAPSED = "+2348000000002";
const seniorYear = new Date().getUTCFullYear() - 16;
async function ensureStudent(firstName: string, klass: string, phone: string, withTrial: boolean) {
  const found = await db
    .from("students")
    .select("id")
    .eq("owner_id", parentId!)
    .eq("first_name", firstName)
    .maybeSingle<{ id: string }>();
  if (found.error) fail("find student", found.error);
  let id = found.data?.id;
  if (!id) {
    const inserted = await db
      .from("students")
      .insert({
        owner_id: parentId,
        first_name: firstName,
        last_initial: "O",
        class: klass,
        birth_year: seniorYear,
        exam: "WASSCE",
        subjects: ["english", "mathematics", "physics", "biology"],
        whatsapp_number: phone,
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
      given_by: parentId,
    });
    if (consent.error) fail("consent", consent.error);
  } else {
    await db.from("students").update({ whatsapp_number: phone }).eq("id", id);
  }
  if (withTrial) {
    const trialEnd = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const trial = await db.rpc("apply_billing_event", {
      p: {
        provider: "trial",
        event_id: `trial:${id}`,
        event_type: "trial.started",
        occurred_at: new Date().toISOString(),
        subscription: {
          student_id: id,
          plan: "nigeria_weekly",
          currency: "NGN",
          status: "trialing",
          trial_end: trialEnd,
          current_period_end: trialEnd,
        },
      },
    });
    if (trial.error) fail("trial", trial.error);
  }
  return id;
}
await ensureStudent("Ada", "SS2", HOUSE, true);
await ensureStudent("Chidi", "SS3", HOUSE, true);
await ensureStudent("Emeka", "SS1", LAPSED, false);
await ensureDemoQuestions(db, await ensureReviewer(db));
console.log("");
console.log(`WhatsApp simulator: ${appUrl}/admin/dev/whatsapp`);
console.log(`  ${HOUSE}  Ada and Chidi (siblings, free trial)`);
console.log(`  ${LAPSED}  Emeka (plan lapsed: gets a sponsor link)`);
console.log("  any other number: unknown (gets the free-trial offer)");
console.log("Make yourself admin first: npm run make-admin -- --email you@example.com");
