import "server-only";
import { parseEnvGroup } from "@/lib/env";
import { anthropicDrafter, type QuestionDrafter } from "./llm";

// Production wiring for "Draft 10 questions": null until LLM_API_KEY and LLM_MODEL are set.
export function questionDrafter(): QuestionDrafter | null {
  try {
    const env = parseEnvGroup("llm", process.env);
    return anthropicDrafter({ apiKey: env.LLM_API_KEY, model: env.LLM_MODEL });
  } catch {
    return null;
  }
}
