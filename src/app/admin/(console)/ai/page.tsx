import type { Metadata } from "next";
import { Card, Notice, styles } from "@/components/ui";
import { EXPLAIN_PROMPT_VERSION } from "@/config/ai";
import { aiStats, listExplanations } from "@/lib/ai/admin";
import { requireAdmin } from "@/lib/auth";
import { appSql } from "@/lib/db/postgres";
import { flagExplanationAction } from "../actions";

export const metadata: Metadata = { title: "AI explanations" };

const LETTERS = ["A", "B", "C", "D", "E"];

// "Explain another way" by AI: what it costs, what it said, and flagging a bad explanation (it
// leaves the cache; the next student asking gets a new one).
export default async function AiPage({ searchParams }: PageProps<"/admin/ai">) {
  await requireAdmin("/admin/ai");
  const query = await searchParams;
  const sql = appSql();
  const [stats, recent, flagged] = await Promise.all([
    aiStats(sql, new Date()),
    listExplanations(sql, { flagged: false, limit: 50 }),
    listExplanations(sql, { flagged: true, limit: 20 }),
  ]);
  const t = stats.today;
  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-bold text-navy-dark">AI explanations</h1>
      {typeof query.error === "string" && <Notice tone="warn">{query.error}</Notice>}
      {typeof query.done === "string" && <Notice tone="good">{query.done}</Notice>}
      <div className="grid gap-3 md:grid-cols-3">
        <Card>
          <p className="font-semibold">Today</p>
          <p className="text-sm">
            {t.model} new · {t.cache} from the cache · {t.limit} over the daily limit · {t.fallback}{" "}
            teacher&apos;s explanation instead · {t.refused} refused
          </p>
        </Card>
        <Card>
          <p className="font-semibold">This month</p>
          <p className="text-3xl font-bold text-navy">${stats.month.costUsd.toFixed(4)}</p>
          <p className={styles.hint}>
            {stats.month.calls} AI calls ({stats.month.inputTokens} in / {stats.month.outputTokens}{" "}
            out tokens) · {stats.month.cacheHits} served free from the cache
          </p>
        </Card>
        <Card>
          <p className="font-semibold">Prompt</p>
          <p className="font-mono text-sm">{EXPLAIN_PROMPT_VERSION}</p>
          <p className={styles.hint}>The daily limit per student is in Settings.</p>
        </Card>
      </div>

      <section aria-labelledby="recent">
        <h2 id="recent" className="mb-2 text-lg font-bold text-navy-dark">
          Recent explanations
        </h2>
        <ul className="flex flex-col gap-3">
          {recent.map((e) => (
            <li key={e.id}>
              <Card className="flex flex-col gap-2">
                <p className="text-sm text-navy-dark/70">
                  {e.stem} · {e.language === "pcm" ? "Pidgin" : "English"} ·{" "}
                  {e.wrong_option >= 0
                    ? `after choosing ${LETTERS[e.wrong_option]}`
                    : "after a right answer"}{" "}
                  · used {e.uses} time{e.uses === 1 ? "" : "s"} · ${e.cost_usd.toFixed(5)}
                </p>
                <p className="whitespace-pre-wrap">{e.text}</p>
                <form
                  action={flagExplanationAction.bind(null, e.id)}
                  className="flex flex-wrap gap-2"
                >
                  <input
                    name="reason"
                    required
                    minLength={3}
                    maxLength={500}
                    placeholder="What's wrong with it?"
                    aria-label="What's wrong with it?"
                    className={`${styles.input} min-w-64 flex-1`}
                  />
                  <button className={styles.dangerButton}>Flag and remove</button>
                </form>
              </Card>
            </li>
          ))}
          {recent.length === 0 && <p className={styles.hint}>None yet.</p>}
        </ul>
      </section>

      {flagged.length > 0 && (
        <section aria-labelledby="flagged">
          <h2 id="flagged" className="mb-2 text-lg font-bold text-navy-dark">
            Flagged
          </h2>
          <ul className="flex flex-col gap-2 text-sm">
            {flagged.map((e) => (
              <li key={e.id}>
                <strong>{e.flag_reason}</strong>: “{e.text.slice(0, 160)}”
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
