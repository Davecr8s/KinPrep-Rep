// Gives an existing KinPrep account the admin role (the founder). Sign in to the app once first.
// Usage: npm run make-admin -- --email you@example.com
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
const arg = process.argv.indexOf("--email");
const email = arg > 0 ? process.argv[arg + 1]?.toLowerCase() : undefined;
if (!url || !secret || !email) {
  console.error(
    "Usage: npm run make-admin -- --email you@example.com (with Supabase keys in .env.local)",
  );
  process.exit(1);
}

const db = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
const listed = await db.auth.admin.listUsers({ perPage: 1000 });
if (listed.error) throw new Error(listed.error.message);
const user = listed.data.users.find((u) => u.email?.toLowerCase() === email);
if (!user) {
  console.error(`No account for ${email}. Sign in at /app/sign-in first, then run this again.`);
  process.exit(1);
}
const { error } = await db.from("profiles").upsert({ id: user.id, role: "admin" });
if (error) throw new Error(error.message);
const audit = await db.from("audit_log").insert({
  actor_id: user.id,
  action: "profile.made_admin",
  entity_type: "profile",
  entity_id: user.id,
  details: { via: "scripts/make-admin.ts" },
});
if (audit.error) throw new Error(audit.error.message);
console.log(`${email} is now an admin.`);
