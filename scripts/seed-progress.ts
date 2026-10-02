// Creates FAKE practice history so the payer dashboard has something to show.
// Usage:
//   npm run seed:progress -- --email sponsor@example.com   (that payer's children)
//   npm run seed:progress                                  (every child with no answers yet)
// Adds a seed reviewer, demo topics and approved demo questions (fake, for development only),
// then 8 weeks of sessions: most days practised, accuracy improving, one weak topic per subject.
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
if (!url || !secret) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set in .env.local.");
  process.exit(1);
}
const db = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });

function must<T>(result: { data: T; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result.data;
}

type Subject = "english" | "mathematics" | "physics" | "biology";
const TOPICS: Record<Subject, string[]> = {
  english: ["Concord", "Comprehension", "Lexis and structure", "Oral English", "Summary"],
  mathematics: ["Algebra", "Indices and logarithms", "Geometry", "Statistics", "Probability"],
  physics: ["Motion", "Vectors", "Electricity", "Waves", "Heat"],
  biology: ["Cells", "Ecology", "Genetics", "Nutrition", "Reproduction"],
};
// The topic each fake student finds hardest, so "weakest topics" has something to show.
const WEAK: Record<Subject, string> = {
  english: "Oral English",
  mathematics: "Indices and logarithms",
  physics: "Vectors",
  biology: "Genetics",
};

// 1. Seed reviewer (questions must be approved by a teacher).
const REVIEWER_EMAIL = "seed-reviewer@kinprep.test";
const listed = await db.auth.admin.listUsers({ perPage: 1000 });
if (listed.error) throw new Error(`list users: ${listed.error.message}`);
const users = listed.data;
let reviewerId = users.users.find((u) => u.email === REVIEWER_EMAIL)?.id;
if (!reviewerId) {
  const created = await db.auth.admin.createUser({ email: REVIEWER_EMAIL, email_confirm: true });
  if (created.error) throw new Error(`reviewer: ${created.error.message}`);
  reviewerId = created.data.user.id;
}
must(await db.from("profiles").upsert({ id: reviewerId, role: "reviewer" }), "reviewer profile");

// 2. Demo topics and approved demo questions.
const questionIds = new Map<string, { id: string; subject: Subject; topic: string }[]>();
for (const [subject, names] of Object.entries(TOPICS) as [Subject, string[]][]) {
  for (const name of names) {
    const topic = must(
      await db
        .from("topics")
        .upsert({ subject, name }, { onConflict: "subject,name" })
        .select("id")
        .single(),
      "topic",
    ) as { id: string };
    let existing = must(
      await db.from("questions").select("id").eq("topic_id", topic.id),
      "questions",
    ) as { id: string }[];
    if (existing.length === 0) {
      existing = must(
        await db
          .from("questions")
          .insert(
            [1, 2, 3, 4].map((n) => ({
              subject,
              topic_id: topic.id,
              stem: `[Demo] ${name} practice question ${n}. Which option is correct?`,
              options: ["Option A", "Option B", "Option C", "Option D"],
              answer_index: n % 4,
              explanation_en: `Demo explanation for ${name} question ${n}.`,
              explanation_pcm: `Demo explanation for ${name} question ${n}, for Pidgin.`,
              status: "approved",
              approved_by: reviewerId,
              approved_at: new Date().toISOString(),
              created_by: reviewerId,
            })),
          )
          .select("id"),
        "insert questions",
      ) as { id: string }[];
    }
    questionIds.set(
      `${subject}:${name}`,
      existing.map((q) => ({ id: q.id, subject, topic: name })),
    );
  }
}

// 3. Which students.
const emailArg = process.argv.indexOf("--email");
let students: { id: string; first_name: string; subjects: Subject[] }[];
if (emailArg > 0) {
  const email = process.argv[emailArg + 1]?.toLowerCase();
  const owner = users.users.find((u) => u.email?.toLowerCase() === email);
  if (!owner) throw new Error(`No user with email ${email}`);
  students = must(
    await db.from("students").select("id, first_name, subjects").eq("owner_id", owner.id),
    "students",
  ) as typeof students;
} else {
  const all = must(
    await db.from("students").select("id, first_name, subjects"),
    "students",
  ) as typeof students;
  const answered = new Set(
    (
      must(await db.from("answers").select("student_id"), "answers") as { student_id: string }[]
    ).map((a) => a.student_id),
  );
  students = all.filter((s) => !answered.has(s.id));
}
if (students.length === 0) {
  console.log("No students to seed.");
  process.exit(0);
}

// Deterministic pseudo-random numbers per student, so re-running looks the same.
function rng(seed: string) {
  let state = createHash("sha256").update(seed).digest().readUInt32LE(0) || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 10_000) / 10_000;
  };
}

const DAYS = 56;
const now = Date.now();
for (const student of students) {
  const random = rng(student.id);
  const subjects =
    student.subjects.length > 0 ? student.subjects : (["english", "mathematics"] as Subject[]);
  const pool = subjects.flatMap((s) =>
    TOPICS[s].flatMap((t) => questionIds.get(`${s}:${t}`) ?? []),
  );
  let answers = 0;
  for (let daysAgo = DAYS; daysAgo >= 0; daysAgo--) {
    if (random() > 0.78) continue; // skipped day
    // Practise in the Lagos evening (around 18:00-21:00 Lagos = 17:00-20:00 UTC).
    const day = new Date(now - daysAgo * 86_400_000);
    day.setUTCHours(17 + Math.floor(random() * 3), Math.floor(random() * 60), 0, 0);
    if (day.getTime() > now) continue;
    const session = must(
      await db
        .from("practice_sessions")
        .insert({
          student_id: student.id,
          channel: "whatsapp",
          started_at: day.toISOString(),
          ended_at: new Date(day.getTime() + 15 * 60_000).toISOString(),
        })
        .select("id")
        .single(),
      "session",
    ) as { id: string };
    const count = 5 + Math.floor(random() * 6);
    const progress = 1 - daysAgo / DAYS; // 0 eight weeks ago -> 1 today
    const used = new Set<string>();
    const rows = [];
    for (let i = 0; i < count; i++) {
      let q = pool[Math.floor(random() * pool.length)]!;
      for (let tries = 0; used.has(q.id) && tries < 10; tries++)
        q = pool[Math.floor(random() * pool.length)]!;
      if (used.has(q.id)) continue;
      used.add(q.id);
      const chance = 0.5 + 0.25 * progress - (WEAK[q.subject] === q.topic ? 0.3 : 0);
      const correct = random() < chance;
      rows.push({
        session_id: session.id,
        student_id: student.id,
        question_id: q.id,
        chosen_index: correct ? 0 : 1,
        correct,
        answered_at: new Date(day.getTime() + i * 60_000).toISOString(),
      });
    }
    must(await db.from("answers").insert(rows), "answers");
    answers += rows.length;
  }
  console.log(`${student.first_name}: ${answers} answers over ${DAYS / 7} weeks`);
}
