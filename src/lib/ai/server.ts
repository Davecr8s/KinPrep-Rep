import "server-only";
import { appSql } from "@/lib/db/postgres";
import { parseEnvGroup } from "@/lib/env";
import type { ExplainAnotherWay } from "@/lib/practice/explain";
import { aiExplainer } from "./explain";
import { anthropicModel, type ExplainModel } from "./model";

// Production wiring for the AI "Explain another way": null model (teacher's explanation instead)
// until LLM_API_KEY and LLM_MODEL are set.

export function explainModel(): ExplainModel | null {
  try {
    const env = parseEnvGroup("llm", process.env);
    return anthropicModel({ apiKey: env.LLM_API_KEY, model: env.LLM_MODEL });
  } catch {
    return null;
  }
}

/** The hook the bot and the web page use. */
export function productionExplainer(): ExplainAnotherWay {
  return aiExplainer({ sql: appSql(), model: explainModel() });
}
