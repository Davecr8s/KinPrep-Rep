// The model behind "Explain another way": one short completion, with token counts for the cost
// log. Anthropic's Messages API (LLM_API_KEY, LLM_MODEL); tests use a fake.

export type Completion = { text: string; model: string; inputTokens: number; outputTokens: number };

export interface ExplainModel {
  complete(prompt: { system: string; user: string }): Promise<Completion>;
}

export function anthropicModel(config: {
  apiKey: string;
  model: string;
  fetch?: typeof fetch;
}): ExplainModel {
  const doFetch = config.fetch ?? fetch;
  return {
    async complete(prompt) {
      const response = await doFetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": config.apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: config.model,
          max_tokens: 400,
          temperature: 0.4,
          system: prompt.system,
          messages: [{ role: "user", content: prompt.user }],
        }),
      });
      const json = (await response.json().catch(() => null)) as {
        content?: { type: string; text?: string }[];
        model?: string;
        usage?: { input_tokens?: number; output_tokens?: number };
        error?: { message?: string };
      } | null;
      if (!response.ok || !json) {
        throw new Error(
          `AI request failed (${response.status}): ${json?.error?.message ?? "no reply"}`,
        );
      }
      return {
        text: (json.content ?? [])
          .filter((c) => c.type === "text")
          .map((c) => c.text ?? "")
          .join("\n")
          .trim(),
        model: json.model ?? config.model,
        inputTokens: json.usage?.input_tokens ?? 0,
        outputTokens: json.usage?.output_tokens ?? 0,
      };
    },
  };
}
