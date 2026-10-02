import { timingSafeEqual } from "node:crypto";
import { appSql } from "@/lib/db/postgres";
import { serverEnv } from "@/lib/env";
import { sendMorningNudges } from "@/lib/whatsapp/morning";
import { cloudTransport, createOutbox } from "@/lib/whatsapp/outbox";
import { runPendingJobs } from "@/lib/whatsapp/server";

export const maxDuration = 300;

// Vercel Cron (vercel.json), 05:00 UTC = 06:00 in Lagos. Vercel sends "Bearer <CRON_SECRET>".
export async function GET(request: Request) {
  const expected = `Bearer ${serverEnv("cron").CRON_SECRET}`;
  const given = request.headers.get("authorization") ?? "";
  if (
    given.length !== expected.length ||
    !timingSafeEqual(Buffer.from(given), Buffer.from(expected))
  ) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Pick up any inbound jobs that failed or were abandoned.
  const retried = await runPendingJobs();

  const env = serverEnv("whatsapp");
  if (!env.WHATSAPP_TEMPLATE_MORNING)
    return Response.json({ retried, nudges: "skipped: no template configured" });
  const sql = appSql();
  const outbox = createOutbox({
    sql,
    transport: cloudTransport({
      accessToken: env.WHATSAPP_ACCESS_TOKEN,
      phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
      graphVersion: env.WHATSAPP_GRAPH_VERSION,
    }),
  });
  const nudges = await sendMorningNudges(sql, outbox, {
    name: env.WHATSAPP_TEMPLATE_MORNING,
    language: "en",
  });
  return Response.json({ retried, nudges });
}
