import { getPaymentProvider } from "@/lib/payments/server";
import { handleProviderWebhook } from "@/lib/payments/webhook-route";

export async function POST(request: Request) {
  return handleProviderWebhook(request, () => getPaymentProvider("stripe"));
}
