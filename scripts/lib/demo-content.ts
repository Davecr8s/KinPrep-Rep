// FAKE demo content shared by the seed scripts: a seed reviewer and approved demo questions.
import type { SupabaseClient } from "@supabase/supabase-js";

export type Subject = "english" | "mathematics" | "physics" | "biology";

export const TOPICS: Record<Subject, string[]> = {
  english: ["Concord", "Comprehension", "Lexis and structure", "Oral English", "Summary"],
  mathematics: ["Algebra", "Indices and logarithms", "Geometry", "Statistics", "Probability"],
  physics: ["Motion", "Vectors", "Electricity", "Waves", "Heat"],
  biology: ["Cells", "Ecology", "Genetics", "Nutrition", "Reproduction"],
};

const REVIEWER_EMAIL = "seed-reviewer@kinprep.test";

/** The seed reviewer's id (questions must be approved by a teacher on record). */
export async function ensureReviewer(db: SupabaseClient): Promise<string> {
  const listed = await db.auth.admin.listUsers({ perPage: 1000 });
  if (listed.error) throw new Error(`list users: ${listed.error.message}`);
  let id = listed.data.users.find((u) => u.email === REVIEWER_EMAIL)?.id;
  if (!id) {
    const created = await db.auth.admin.createUser({ email: REVIEWER_EMAIL, email_confirm: true });
    if (created.error) throw new Error(`reviewer: ${created.error.message}`);
    id = created.data.user.id;
  }
  const profile = await db.from("profiles").upsert({ id, role: "reviewer" });
  if (profile.error) throw new Error(`reviewer profile: ${profile.error.message}`);
  return id;
}

export type DemoQuestion = { id: string; subject: Subject; topic: string };

/** Demo topics with four approved demo questions each; returns them keyed "subject:topic". */
export async function ensureDemoQuestions(
  db: SupabaseClient,
  reviewerId: string,
): Promise<Map<string, DemoQuestion[]>> {
  const out = new Map<string, DemoQuestion[]>();
  for (const [subject, names] of Object.entries(TOPICS) as [Subject, string[]][]) {
    for (const name of names) {
      const topic = await db
        .from("topics")
        .upsert({ subject, name }, { onConflict: "subject,name" })
        .select("id")
        .single();
      if (topic.error) throw new Error(`topic: ${topic.error.message}`);
      const topicId = (topic.data as { id: string }).id;
      const existing = await db.from("questions").select("id").eq("topic_id", topicId);
      if (existing.error) throw new Error(`questions: ${existing.error.message}`);
      let rows = existing.data as { id: string }[];
      if (rows.length === 0) {
        const inserted = await db
          .from("questions")
          .insert(
            [1, 2, 3, 4].map((n) => ({
              subject,
              topic_id: topicId,
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
          .select("id");
        if (inserted.error) throw new Error(`insert questions: ${inserted.error.message}`);
        rows = inserted.data as { id: string }[];
      }
      out.set(
        `${subject}:${name}`,
        rows.map((q) => ({ id: q.id, subject, topic: name })),
      );
    }
  }
  return out;
}
