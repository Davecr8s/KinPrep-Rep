import { audit, AdminError, type Admin } from "@/lib/admin/common";
import type { Sql } from "@/lib/db/sql";
import { lagosDay, lagosDayStart } from "@/lib/rules/days";

// AI explanations for admins: what they cost, and flagging a bad one (it leaves the cache, so the
// next student asking gets a fresh explanation).

export type AiStats = {
  today: Record<"model" | "cache" | "limit" | "refused" | "fallback", number>;
  month: {
    calls: number;
    cacheHits: number;
    costUsd: number;
    inputTokens: number;
    outputTokens: number;
  };
};

export async function aiStats(sql: Sql, now: Date): Promise<AiStats> {
  const today = lagosDay(now);
  const rows = await sql.query<{
    outcome: AiStats["today"] extends Record<infer K, number> ? K : never;
    n: number;
  }>(
    "select outcome, count(*)::int as n from public.ai_explanation_requests where lagos_day = $1 group by outcome",
    [today],
  );
  const [month] = await sql.query<{
    calls: number;
    cache_hits: number;
    cost: number;
    input_tokens: number;
    output_tokens: number;
  }>(
    `select (count(*) filter (where outcome in ('model', 'fallback') and model is not null))::int as calls,
            (count(*) filter (where outcome = 'cache'))::int as cache_hits,
            coalesce(sum(cost_usd), 0)::float8 as cost,
            coalesce(sum(input_tokens), 0)::int as input_tokens,
            coalesce(sum(output_tokens), 0)::int as output_tokens
     from public.ai_explanation_requests where created_at >= $1`,
    [lagosDayStart(`${today.slice(0, 7)}-01`)],
  );
  const counts = { model: 0, cache: 0, limit: 0, refused: 0, fallback: 0 };
  for (const r of rows) counts[r.outcome] = r.n;
  return {
    today: counts,
    month: {
      calls: month!.calls,
      cacheHits: month!.cache_hits,
      costUsd: Number(month!.cost),
      inputTokens: month!.input_tokens,
      outputTokens: month!.output_tokens,
    },
  };
}

export type AiExplanationRow = {
  id: string;
  question_id: string;
  stem: string;
  language: "en" | "pcm";
  wrong_option: number;
  text: string;
  uses: number;
  cost_usd: number;
  prompt_version: string;
  model: string;
  created_at: Date;
  flagged_at: Date | null;
  flag_reason: string | null;
};

export async function listExplanations(
  sql: Sql,
  filter: { flagged?: boolean; limit?: number } = {},
): Promise<AiExplanationRow[]> {
  return sql.query<AiExplanationRow>(
    `select e.id::text, e.question_id::text, q.stem, e.language, e.wrong_option, e.text, e.uses,
            e.cost_usd::float8 as cost_usd, e.prompt_version, e.model, e.created_at, e.flagged_at, e.flag_reason
     from public.ai_explanations e join public.questions q on q.id = e.question_id
     where ($1::boolean is null or (e.flagged_at is not null) = $1)
     order by e.created_at desc
     limit $2`,
    [filter.flagged ?? null, filter.limit ?? 100],
  );
}

/** A bad explanation: no longer served; the next request for the same case asks the AI again. */
export async function flagExplanation(
  sql: Sql,
  admin: Admin,
  id: string,
  reason: string,
  now: Date,
): Promise<void> {
  const why = reason.trim();
  if (why.length < 3 || why.length > 500) throw new AdminError("Say what's wrong with it.");
  const rows = await sql.query(
    `update public.ai_explanations set flagged_at = $2, flagged_by = $3, flag_reason = $4
     where id = $1 and flagged_at is null returning id`,
    [id, now, admin.id, why],
  );
  if (!rows.length) throw new AdminError("That explanation is already flagged, or doesn't exist.");
  await audit(sql, admin, "ai_explanation.flagged", "ai_explanation", id, { reason: why });
}
