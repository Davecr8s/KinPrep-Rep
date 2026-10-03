import { AI_EXPLANATIONS_PER_DAY, EXPLAIN_PROMPT_VERSION } from "@/config/ai";
import type { Sql } from "@/lib/db/sql";
import { prewrittenAlternative, type ExplainAnotherWay } from "@/lib/practice/explain";
import { getQuestion, type Question } from "@/lib/practice/repo";
import { verifyPracticeLink } from "@/lib/practice/links";
import { lagosDay } from "@/lib/rules/days";
import type { ExplainModel } from "./model";
import { checkReply, costUsd, explainPrompt, ExplainRequestSchema, wrongOption } from "./rules";

// "Explain another way" with AI, for the bot and the web page (CLAUDE.md: the AI only re-explains
// the current question; students can't chat with it). A request names one question the student has
// been set, and nothing else. Each student gets a few a day (setting "ai_explanations_per_day",
// default 5); answers are cached per question, language and wrong option, so repeats are free;
// every request is logged with the prompt version, tokens and cost. When anything is off (limit
// reached, no model, a reply that fails the checks) the student gets the teacher's explanation.

export type ExplainOutcome = "model" | "cache" | "limit" | "refused" | "fallback";

export type ExplainResult = {
  outcome: ExplainOutcome;
  text: string;
  reason?: string;
  /** AI explanations left today for this student. */
  remainingToday: number;
};

export type ExplainDeps = { sql: Sql; model: ExplainModel | null; now: Date };

export const REFUSAL =
  "I can only explain the question you're working on. Tap “Explain another way” on a question you've answered.";

export async function aiExplanationsPerDay(sql: Sql): Promise<number> {
  const [row] = await sql.query<{ value: unknown }>(
    "select value from public.settings where key = 'ai_explanations_per_day'",
  );
  const n = Number(row?.value);
  return Number.isInteger(n) && n >= 0 && n <= 50 ? n : AI_EXPLANATIONS_PER_DAY;
}

type LogEntry = {
  studentId: string | null;
  questionId: string | null;
  language: "en" | "pcm" | null;
  wrongOption: number | null;
  outcome: ExplainOutcome;
  reason?: string;
  explanationId?: string | null;
  model?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
};

async function log(sql: Sql, now: Date, e: LogEntry): Promise<void> {
  await sql.query(
    `insert into public.ai_explanation_requests
       (student_id, question_id, language, wrong_option, outcome, reason, explanation_id, prompt_version,
        model, input_tokens, output_tokens, cost_usd, lagos_day, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      e.studentId,
      e.questionId,
      e.language,
      e.wrongOption,
      e.outcome,
      e.reason?.slice(0, 300) ?? null,
      e.explanationId ?? null,
      EXPLAIN_PROMPT_VERSION,
      e.model ?? null,
      e.inputTokens ?? 0,
      e.outputTokens ?? 0,
      e.costUsd ?? 0,
      lagosDay(now),
      now,
    ],
  );
}

export async function explainAnotherWay(deps: ExplainDeps, raw: unknown): Promise<ExplainResult> {
  const { sql, now } = deps;
  const parsed = ExplainRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const ids = (raw ?? {}) as { studentId?: unknown; questionId?: unknown };
    const uuid = (v: unknown) => (typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v) ? v : null);
    await log(sql, now, {
      studentId: (await exists(sql, "students", uuid(ids.studentId))) ? uuid(ids.studentId) : null,
      questionId: (await exists(sql, "questions", uuid(ids.questionId)))
        ? uuid(ids.questionId)
        : null,
      language: null,
      wrongOption: null,
      outcome: "refused",
      reason: "not a request about one question",
    });
    return { outcome: "refused", text: REFUSAL, reason: "invalid request", remainingToday: 0 };
  }
  const request = parsed.data;
  const language = request.language === "pidgin" ? "pcm" : "en";
  const base = { studentId: request.studentId, questionId: request.questionId, language } as const;

  // Only an approved question this student has actually been set.
  const [allowed] = await sql.query<{ ok: boolean }>(
    `select exists (
       select 1 from public.questions q
       where q.id = $2 and q.status = 'approved'
         and exists (select 1 from public.practice_sessions s where s.student_id = $1 and q.id = any(s.question_ids))
     ) as ok`,
    [request.studentId, request.questionId],
  );
  if (!allowed?.ok) {
    const known = await exists(sql, "students", request.studentId);
    await log(sql, now, {
      ...base,
      studentId: known ? request.studentId : null,
      questionId: (await exists(sql, "questions", request.questionId)) ? request.questionId : null,
      wrongOption: null,
      outcome: "refused",
      reason: "not a question from this student's sets",
    });
    return { outcome: "refused", text: REFUSAL, reason: "not your question", remainingToday: 0 };
  }

  const question = await getQuestion(sql, request.questionId);
  const wrong = wrongOption(question, request.chosenOption);
  const teacher = () => prewrittenAlternative({ question, language });
  const limit = await aiExplanationsPerDay(sql);
  const [{ used }] = (await sql.query<{ used: number }>(
    `select count(*)::int as used from public.ai_explanation_requests
     where student_id = $1 and lagos_day = $2 and outcome in ('model', 'cache')`,
    [request.studentId, lagosDay(now)],
  )) as [{ used: number }];
  const entry = { ...base, wrongOption: wrong };

  if (used >= limit) {
    await log(sql, now, { ...entry, outcome: "limit", reason: `${limit} a day` });
    return { outcome: "limit", text: await teacher(), reason: "daily limit", remainingToday: 0 };
  }

  const [cached] = await sql.query<{ id: string; text: string }>(
    `update public.ai_explanations set uses = uses + 1
     where question_id = $1 and language = $2 and wrong_option = $3 and prompt_version = $4
       and flagged_at is null
     returning id::text, text`,
    [request.questionId, language, wrong, EXPLAIN_PROMPT_VERSION],
  );
  if (cached) {
    await log(sql, now, { ...entry, outcome: "cache", explanationId: cached.id });
    return { outcome: "cache", text: cached.text, remainingToday: limit - used - 1 };
  }

  if (!deps.model) {
    await log(sql, now, { ...entry, outcome: "fallback", reason: "AI not set up" });
    return {
      outcome: "fallback",
      text: await teacher(),
      reason: "AI not set up",
      remainingToday: limit - used,
    };
  }

  let completion;
  try {
    completion = await deps.model.complete(explainPrompt(question, language, wrong));
  } catch (error) {
    await log(sql, now, {
      ...entry,
      outcome: "fallback",
      reason: String(error instanceof Error ? error.message : error),
    });
    return {
      outcome: "fallback",
      text: await teacher(),
      reason: "AI error",
      remainingToday: limit - used,
    };
  }
  const cost = costUsd(completion.model, completion.inputTokens, completion.outputTokens);
  const usage = {
    model: completion.model,
    inputTokens: completion.inputTokens,
    outputTokens: completion.outputTokens,
    costUsd: cost,
  };
  const check = checkReply(completion.text, question);
  if (!check.ok) {
    await log(sql, now, {
      ...entry,
      ...usage,
      outcome: "fallback",
      reason: `reply ${check.reason}`,
    });
    return {
      outcome: "fallback",
      text: await teacher(),
      reason: check.reason,
      remainingToday: limit - used,
    };
  }
  const [saved] = await sql.query<{ id: string }>(
    `insert into public.ai_explanations
       (question_id, language, wrong_option, prompt_version, text, model, input_tokens, output_tokens, cost_usd, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     on conflict (question_id, language, wrong_option, prompt_version) where flagged_at is null do nothing
     returning id::text`,
    [
      request.questionId,
      language,
      wrong,
      EXPLAIN_PROMPT_VERSION,
      check.text,
      completion.model,
      completion.inputTokens,
      completion.outputTokens,
      cost,
      now,
    ],
  );
  await log(sql, now, { ...entry, ...usage, outcome: "model", explanationId: saved?.id ?? null });
  return { outcome: "model", text: check.text, remainingToday: limit - used - 1 };
}

async function exists(
  sql: Sql,
  table: "students" | "questions",
  id: string | null,
): Promise<boolean> {
  if (!id) return false;
  const rows = await sql.query(`select 1 from public.${table} where id = $1`, [id]);
  return rows.length > 0;
}

/** The bot's and the web page's "Explain another way" hook, backed by the AI. */
export function aiExplainer(
  deps: Omit<ExplainDeps, "now"> & { now?: () => Date },
): ExplainAnotherWay {
  return async ({ question, language, studentId, chosenIndex }) => {
    if (!studentId) return prewrittenAlternative({ question, language });
    const result = await explainAnotherWay(
      { sql: deps.sql, model: deps.model, now: deps.now?.() ?? new Date() },
      {
        questionId: question.id,
        studentId,
        language: language === "pcm" ? "pidgin" : "english",
        chosenOption: chosenIndex ?? null,
      },
    );
    return result.text;
  };
}

export type { Question };

/**
 * POST /api/explain: the body is the request plus the student's practice link token, which must
 * belong to the student named. Returns the HTTP status and JSON.
 */
export async function handleExplainPost(
  deps: ExplainDeps & { secret: string },
  body: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { status: 400, json: { error: "Send a JSON object" } };
  }
  const { token, ...rest } = body as Record<string, unknown>;
  if (typeof token !== "string" || token.length > 100) {
    return { status: 401, json: { error: "Missing practice link token" } };
  }
  const link = verifyPracticeLink(token, deps.secret, deps.now);
  if (!link.ok || link.studentId !== rest.studentId) {
    return { status: 403, json: { error: "That link doesn't match this student" } };
  }
  const result = await explainAnotherWay(deps, rest);
  return {
    status: result.outcome === "refused" ? 400 : 200,
    json: { outcome: result.outcome, text: result.text, remainingToday: result.remainingToday },
  };
}
