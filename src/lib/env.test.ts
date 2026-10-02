import { describe, expect, it } from "vitest";
import { parseEnvGroup } from "./env";

describe("parseEnvGroup", () => {
  it("returns only the group's variables when valid", () => {
    const env = parseEnvGroup("stripe", {
      STRIPE_SECRET_KEY: "sk_test_123",
      STRIPE_WEBHOOK_SECRET: "whsec_456",
      UNRELATED: "ignored",
    });
    expect(env).toEqual({
      STRIPE_SECRET_KEY: "sk_test_123",
      STRIPE_WEBHOOK_SECRET: "whsec_456",
    });
  });

  it("names missing variables in the error", () => {
    expect(() => parseEnvGroup("whatsapp", {})).toThrow(/WHATSAPP_ACCESS_TOKEN/);
  });

  it("never includes secret values in the error", () => {
    const leaked = "sk_live_should_not_appear";
    try {
      parseEnvGroup("stripe", { STRIPE_SECRET_KEY: leaked, STRIPE_WEBHOOK_SECRET: "bad" });
      expect.unreachable();
    } catch (error) {
      expect(String(error)).toContain("STRIPE_WEBHOOK_SECRET");
      expect(String(error)).not.toContain(leaked);
    }
  });

  it("rejects a short cron secret", () => {
    expect(() => parseEnvGroup("cron", { CRON_SECRET: "short" })).toThrow(/CRON_SECRET/);
  });
});

describe("database pool size", () => {
  const url = "postgres://user:pass@host:6543/postgres";
  it("defaults to 3, treats an empty value as unset, and allows 1-10", () => {
    const pool = (value?: string) =>
      parseEnvGroup("database", { SUPABASE_DB_URL: url, SUPABASE_DB_POOL_MAX: value })
        .SUPABASE_DB_POOL_MAX;
    expect(pool()).toBe(3);
    expect(pool("")).toBe(3);
    expect(pool("1")).toBe(1);
    expect(() => pool("0")).toThrow(/SUPABASE_DB_POOL_MAX/);
  });
});
