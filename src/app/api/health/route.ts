import { appSql } from "@/lib/db/postgres";
import { envGroups, type EnvGroup } from "@/lib/env";
import { checkHealth } from "@/lib/monitoring/health";
import { hasBearer } from "@/lib/security/cron-auth";

// GET /api/health: 200 if the site and its database are up, 503 if not. With
// "Authorization: Bearer <CRON_SECRET>" it also checks the webhook and message backlogs and says
// which integrations have their keys (names and true/false only, never values).

export async function GET(request: Request) {
  const detailed = hasBearer(request, process.env.CRON_SECRET);
  const health = await checkHealth({
    sql: appSql,
    now: new Date(),
    detailed,
    configured: () =>
      Object.fromEntries(
        (Object.keys(envGroups) as EnvGroup[]).map((g) => [
          g,
          envGroups[g].safeParse(process.env).success,
        ]),
      ),
  });
  return Response.json(health, {
    status: health.ok ? 200 : 503,
    headers: { "cache-control": "no-store" },
  });
}
