import { WebhookSignatureError, type PaymentProvider } from "./types";

/**
 * Shared body of the provider webhook routes. 400 for a bad signature (the provider shouldn't
 * retry), 500 for anything else (the provider retries, and idempotency makes that safe).
 */
export async function handleProviderWebhook(
  request: Request,
  getProvider: () => PaymentProvider,
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
    console.error(`[webhook:${providerId}] processing failed`, error);
    return Response.json({ error: "processing failed" }, { status: 500 });
  }
}
