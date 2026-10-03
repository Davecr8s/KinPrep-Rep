import "server-only";
import { productionExplainer } from "@/lib/ai/server";
import { appSql } from "@/lib/db/postgres";
import { serverEnv } from "@/lib/env";
import { processJobs } from "./jobs";
import { cloudTransport, createOutbox, simulatedTransport, type Transport } from "./outbox";

// Production wiring for the bot: env-configured transport, direct Postgres.

function transportFor(simulated: boolean): Transport {
  if (simulated) return simulatedTransport();
  const env = serverEnv("whatsapp");
  return cloudTransport({
    accessToken: env.WHATSAPP_ACCESS_TOKEN,
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
    graphVersion: env.WHATSAPP_GRAPH_VERSION,
  });
}

/** Processes pending inbound jobs. Simulator jobs never reach Meta. */
export function runPendingJobs(options: { phone?: string; limit?: number } = {}): Promise<number> {
  const sql = appSql();
  const appUrl = serverEnv("app").NEXT_PUBLIC_APP_URL;
  return processJobs(
    sql,
    (job) => ({
      outbox: createOutbox({ sql, transport: transportFor(job.simulated) }),
      appUrl,
      explainAnotherWay: productionExplainer(),
    }),
    options,
  );
}
