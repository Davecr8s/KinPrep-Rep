import { getPaymentProvider } from "@/lib/payments/server";
import { handleProviderWebhook, webhookHealth } from "@/lib/payments/webhook-route";
import { limitRequest } from "@/lib/security/server";

export async function POST(request: Request) {
  const limited = await limitRequest(request, "webhook");
  if (limited) return limited;
  return handleProviderWebhook(request, () => getPaymentProvider("stripe"));
}

/** For the uptime check: the route is up and has its keys (no details). */
export async function GET() {
  return webhookHealth("stripe");
}
