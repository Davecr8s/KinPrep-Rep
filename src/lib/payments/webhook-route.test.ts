import { describe, expect, it, vi } from "vitest";
import { handleProviderWebhook } from "./webhook-route";
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
    const response = await handleProviderWebhook(request(), () =>
      provider(async () => {
        throw new WebhookSignatureError();
      }),
    );
    expect(response.status).toBe(400);
  });

  it("answers 500 to other failures, including missing configuration, so the sender retries", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = await handleProviderWebhook(request(), () =>
      provider(async () => {
        throw new Error("database down");
      }),
    );
    expect(failing.status).toBe(500);
    const unconfigured = await handleProviderWebhook(request(), () => {
      throw new Error("Invalid or missing stripe environment variables");
    });
    expect(unconfigured.status).toBe(500);
  });
});
