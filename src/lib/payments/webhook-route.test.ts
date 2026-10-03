import { describe, expect, it, vi } from "vitest";
import { handleProviderWebhook, webhookHealth } from "./webhook-route";
import { WebhookSignatureError, type PaymentProvider } from "./types";

const provider = (handleWebhook: PaymentProvider["handleWebhook"]) =>
  ({ id: "stripe", handleWebhook }) as PaymentProvider;

const request = () =>
  new Request("https://kinprep.test/api/webhooks/stripe", {
    method: "POST",
    body: '{"raw": true}',
    headers: { "stripe-signature": "sig" },
  });

describe("handleProviderWebhook", () => {
  it("passes the exact raw body and headers to the provider", async () => {
    const handleWebhook = vi.fn(async () => ({ status: "applied" as const, eventId: "evt_1" }));
    const response = await handleProviderWebhook(request(), () => provider(handleWebhook));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "applied", eventId: "evt_1" });
    const [arg] = handleWebhook.mock.calls[0] as unknown as [{ rawBody: string; headers: Headers }];
    expect(arg.rawBody).toBe('{"raw": true}');
    expect(arg.headers.get("stripe-signature")).toBe("sig");
  });

  it("answers 400 to a bad signature, so the sender doesn't retry", async () => {
    const report = vi.fn(async () => {});
    const response = await handleProviderWebhook(
      request(),
      () =>
        provider(async () => {
          throw new WebhookSignatureError();
        }),
      report,
    );
    expect(response.status).toBe(400);
    expect(report).not.toHaveBeenCalled();
  });

  it("answers 500 to other failures, including missing configuration, and reports each", async () => {
    const report = vi.fn(async () => {});
    const failing = await handleProviderWebhook(
      request(),
      () =>
        provider(async () => {
          throw new Error("database down");
        }),
      report,
    );
    expect(failing.status).toBe(500);
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({ where: "webhook:stripe", tags: { provider: "stripe" } }),
    );
    const unconfigured = await handleProviderWebhook(
      request(),
      () => {
        throw new Error("Invalid or missing stripe environment variables");
      },
      report,
    );
    expect(unconfigured.status).toBe(500);
    expect(report).toHaveBeenCalledTimes(2);
  });
});

describe("webhookHealth (the uptime check)", () => {
  it("is 200 with the keys set and 503 without, and shows no values", async () => {
    const up = webhookHealth("stripe", {
      STRIPE_SECRET_KEY: "sk_test_abc",
      STRIPE_WEBHOOK_SECRET: "whsec_abc",
    });
    expect(up.status).toBe(200);
    const body = await up.text();
    expect(JSON.parse(body)).toEqual({ ok: true, webhook: "stripe" });
    expect(body).not.toContain("sk_test");
    expect(webhookHealth("paystack", {}).status).toBe(503);
  });
});
