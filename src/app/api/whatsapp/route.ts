import { timingSafeEqual } from "node:crypto";
import { after, type NextRequest } from "next/server";
import { appSql } from "@/lib/db/postgres";
import { serverEnv } from "@/lib/env";
import { enqueueInbound } from "@/lib/whatsapp/jobs";
import { runPendingJobs } from "@/lib/whatsapp/server";
import { parseInbound, verifyMetaSignature } from "@/lib/whatsapp/webhook";

// Processing after the response needs time on the serverless function.
export const maxDuration = 60;

/** Meta's subscription check: echo hub.challenge if the verify token matches. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const token = params.get("hub.verify_token") ?? "";
  const expected = serverEnv("whatsapp").WHATSAPP_VERIFY_TOKEN;
  const ok =
    params.get("hub.mode") === "subscribe" &&
    token.length === expected.length &&
    timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  return ok
    ? new Response(params.get("hub.challenge") ?? "", { status: 200 })
    : new Response("Forbidden", { status: 403 });
}

/**
 * Inbound messages: verify X-Hub-Signature-256, store each message as a job (Meta's message id
 * is the key, so retries are ignored), answer 200 at once, then process after the response.
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const { WHATSAPP_APP_SECRET } = serverEnv("whatsapp");
  if (
    !verifyMetaSignature(rawBody, request.headers.get("x-hub-signature-256"), WHATSAPP_APP_SECRET)
  ) {
    return new Response("Invalid signature", { status: 401 });
  }
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
  const messages = parseInbound(body);
  // If storing fails, answer 500 so Meta retries; once stored, the job table owns the message.
  const added = await enqueueInbound(appSql(), messages);
  after(async () => {
    try {
      await runPendingJobs();
    } catch (error) {
      console.error("[whatsapp] processing failed", error);
    }
  });
  return Response.json({ received: messages.length, new: added });
}
