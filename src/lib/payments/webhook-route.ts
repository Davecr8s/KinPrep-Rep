import { parseEnvGroup } from "@/lib/env";
import { reportError } from "@/lib/monitoring/report";
import { WebhookSignatureError, type PaymentProvider } from "./types";

/**
 * Shared body of the provider webhook routes. 400 for a bad signature (the provider shouldn't
 * retry), 500 for anything else (the provider retries, and idempotency makes that safe). Every
 * 500 is reported (Sentry), as a failing webhook means a payer's access may be wrong.
 */
export async function handleProviderWebhook(
  request: Request,
  getProvider: () => PaymentProvider,
  report: typeof reportError = reportError,
): Promise<Response> {
  // The signature covers the exact bytes, so read the raw body before anything parses it.
  const rawBody = await request.text();
  let providerId = "unknown";
  try {
    const provider = getProvider();
    providerId = provider.id;
    const result = await provider.handleWebhook({ rawBody, headers: request.headers });
    return Response.json(result);
  } catch (error) {
    if (error instanceof WebhookSignatureError) {
      return Response.json({ error: "invalid signature" }, { status: 400 });
    }
    await report({ where: `webhook:${providerId}`, error, tags: { provider: providerId } });
    return Response.json({ error: "processing failed" }, { status: 500 });
  }
}

/**
 * GET on a webhook route, for the uptime check: 200 if the route is up and its keys are set,
 * 503 if not. Says nothing else.
 */
export function webhookHealth(
  provider: "stripe" | "paystack",
  env: Record<string, string | undefined> = process.env,
): Response {
  let configured = true;
  try {
    parseEnvGroup(provider, env);
  } catch {
    configured = false;
  }
  return Response.json(
    { ok: configured, webhook: provider },
    { status: configured ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
