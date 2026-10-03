import { describe, expect, it } from "vitest";
import { clientIp, decide, windowStart } from "./rate-limit";

const at = (iso: string) => new Date(iso);
const headers = (h: Record<string, string>) => new Headers(h);

describe("rate-limit windows", () => {
  it("are aligned to the epoch, so every server counts in the same window", () => {
    expect(windowStart(at("2026-10-04T10:07:31Z"), 600)).toEqual(at("2026-10-04T10:00:00Z"));
    expect(windowStart(at("2026-10-04T10:10:00Z"), 600)).toEqual(at("2026-10-04T10:10:00Z"));
    expect(windowStart(at("2026-10-04T10:00:59.999Z"), 60)).toEqual(at("2026-10-04T10:00:00Z"));
  });

  it("allow up to the limit, then say how long to wait", () => {
    const rule = { limit: 3, windowSeconds: 600 };
    const now = at("2026-10-04T10:07:30Z");
    expect(decide(1, rule, now)).toEqual({ ok: true });
    expect(decide(3, rule, now)).toEqual({ ok: true });
    expect(decide(4, rule, now)).toEqual({ ok: false, retryAfterSeconds: 150 });
    // Never "retry after 0 seconds".
    expect(decide(4, rule, at("2026-10-04T10:09:59.900Z"))).toEqual({
      ok: false,
      retryAfterSeconds: 1,
    });
  });
});

describe("the caller's IP address", () => {
  it("is the first x-forwarded-for entry (Vercel's edge sets it), else x-real-ip", () => {
    expect(clientIp(headers({ "x-forwarded-for": "102.89.1.2, 10.0.0.1" }))).toBe("102.89.1.2");
    expect(clientIp(headers({ "x-real-ip": " 2c0f:f5c0::1 " }))).toBe("2c0f:f5c0::1");
    expect(clientIp(headers({ "x-forwarded-for": " ", "x-real-ip": "1.2.3.4" }))).toBe("1.2.3.4");
  });

  it("is 'unknown' when missing or junk, so those callers share one bucket", () => {
    expect(clientIp(headers({}))).toBe("unknown");
    expect(clientIp(headers({ "x-forwarded-for": "x".repeat(65) }))).toBe("unknown");
  });
});
