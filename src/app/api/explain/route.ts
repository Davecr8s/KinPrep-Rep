import { handleExplainPost } from "@/lib/ai/explain";
import { explainModel } from "@/lib/ai/server";
import { appSql } from "@/lib/db/postgres";
import { serverEnv } from "@/lib/env";
import { limitRequest } from "@/lib/security/server";

// POST /api/explain: "Explain another way" for one question. The bot and the web page call the
// same code in-process (src/lib/ai/explain.ts); this endpoint is for the practice page's own
// script and other clients. The student's practice link token proves who is asking.
//   { token, questionId, studentId, language: "english" | "pidgin", chosenOption: 0-4 | null }
// Anything else in the body (free text, a "prompt") is refused: the AI isn't a chat.

const MAX_BODY = 2_000;

export async function POST(request: Request) {
  const limited = await limitRequest(request, "explain");
  if (limited) return limited;
  const raw = await request.text();
  if (raw.length > MAX_BODY) return Response.json({ error: "Too large" }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Send JSON" }, { status: 400 });
  }
  const { status, json } = await handleExplainPost(
    {
      sql: appSql(),
      model: explainModel(),
      now: new Date(),
      secret: serverEnv("practice").PRACTICE_LINK_SECRET,
    },
    body,
  );
  return Response.json(json, { status, headers: { "cache-control": "no-store" } });
}
