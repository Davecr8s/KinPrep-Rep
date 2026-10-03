import { afterEach, describe, expect, it, vi } from "vitest";
import { backlogProblems } from "./health";
import { reportError } from "./report";
import { parseDsn, scrub, scrubPath, sentryRequest } from "./sentry";

const DSN = "https://abc123publickey@o4501.ingest.de.sentry.io/4507001";

afterEach(() => vi.restoreAllMocks());

describe("what leaves the server in an error report", () => {
  it("has no emails, phone numbers or tokens", () => {
    expect(scrub("payer ada.okafor+kp@gmail.com failed")).toBe("payer [email] failed");
    expect(scrub("send to +234 803 123 4567 failed")).toBe("send to [phone] failed");
    expect(scrub("token kq3hD9xYz_0aBcDeFgHiJkLmNoPqRs expired")).toBe("token [token] expired");
    expect(scrub("Question not found")).toBe("Question not found");
  });

  it("has paths without query strings or token segments", () => {
    expect(scrubPath("/p/kq3hD9xYz_0aBcDeFgHiJkLmNoPqRs?answer=2")).toBe("/p/:id");
    expect(scrubPath("/sponsor/AbCdEfGhIjKlMnOpQrStUv/thanks")).toBe("/sponsor/:id/thanks");
    expect(scrubPath("/app/children/0b9a8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d")).toBe(
      "/app/children/:id",
    );
    expect(scrubPath("/admin/students#x")).toBe("/admin/students");
  });
});

describe("Sentry", () => {
  it("reads a DSN, and rejects anything else", () => {
    expect(parseDsn(DSN)).toEqual({
      key: "abc123publickey",
      host: "o4501.ingest.de.sentry.io",
      projectId: "4507001",
      protocol: "https:",
    });
    expect(parseDsn("not a url")).toBeNull();
    expect(parseDsn("https://o4501.ingest.sentry.io/4507001")).toBeNull();
    expect(parseDsn("https://key@o4501.ingest.sentry.io/")).toBeNull();
  });

  it("gets one envelope per error, scrubbed", () => {
    const error = Object.assign(new Error("No consent for +2348031234567"), { digest: "123" });
    const req = sentryRequest(
      parseDsn(DSN)!,
      { where: "webhook:stripe", error, method: "POST", path: "/api/webhooks/stripe?x=1" },
      {
        eventId: "e1",
        now: new Date("2026-10-04T10:00:00Z"),
        environment: "production",
        release: "abc",
      },
    );
    expect(req.url).toBe("https://o4501.ingest.de.sentry.io/api/4507001/envelope/");
    expect(req.headers["x-sentry-auth"]).toContain("sentry_key=abc123publickey");
    const [header, type, event] = req.body.split("\n").map((l) => JSON.parse(l));
    expect(header).toEqual({ event_id: "e1", sent_at: "2026-10-04T10:00:00.000Z" });
    expect(type).toEqual({ type: "event" });
    expect(event).toMatchObject({
      level: "error",
      environment: "production",
      release: "abc",
      transaction: "webhook:stripe",
      tags: { where: "webhook:stripe", method: "POST" },
      request: { method: "POST", url: "/api/webhooks/stripe" },
      exception: { values: [{ type: "Error", value: "No consent for [phone] (digest 123)" }] },
    });
    expect(req.body).not.toContain("2348031234567");
    // A thrown string, with no request.
    const plain = sentryRequest(
      parseDsn(DSN)!,
      { where: "job:morning", error: "boom", level: "warning" },
      { eventId: "e2", now: new Date(), environment: "preview" },
    );
    const ev = JSON.parse(plain.body.split("\n")[2]!);
    expect(ev).toMatchObject({ level: "warning", exception: { values: [{ value: "boom" }] } });
    expect(ev.request).toBeUndefined();
    expect(ev.release).toBeUndefined();
  });

  it("is only called when SENTRY_DSN is set, and a failure never throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetch = vi.fn(async () => new Response("", { status: 200 }));
    await reportError({ where: "x", error: new Error("a") }, { fetch, env: {} });
    expect(fetch).not.toHaveBeenCalled();
    await reportError(
      { where: "x", error: new Error("a") },
      { fetch, env: { SENTRY_DSN: DSN, VERCEL_ENV: "preview" } },
    );
    expect(fetch).toHaveBeenCalledOnce();
    const failing = vi.fn(async () => {
      throw new Error("offline");
    });
    await expect(
      reportError({ where: "x", error: "b" }, { fetch: failing, env: { SENTRY_DSN: DSN } }),
    ).resolves.toBeUndefined();
    const refused = vi.fn(async () => new Response("", { status: 429 }));
    await reportError({ where: "x", error: "c" }, { fetch: refused, env: { SENTRY_DSN: DSN } });
    expect(console.error).toHaveBeenCalledWith("[monitoring] Sentry answered 429");
  });
});

describe("health alarms", () => {
  it("go off for stuck payment webhooks and failing WhatsApp, not for a few failed sends", () => {
    const quiet = {
      paymentEventsStuck: 0,
      whatsappJobsFailed: 0,
      whatsappJobsStuck: 0,
      outboundFailed: 3,
    };
    expect(backlogProblems(quiet)).toEqual([]);
    expect(
      backlogProblems({
        paymentEventsStuck: 1,
        whatsappJobsFailed: 2,
        whatsappJobsStuck: 1,
        outboundFailed: 12,
      }),
    ).toEqual([
      "1 payment webhook(s) stuck",
      "2 WhatsApp message(s) failed",
      "1 WhatsApp message(s) stuck",
      "12 outbound messages failed today",
    ]);
  });
});
