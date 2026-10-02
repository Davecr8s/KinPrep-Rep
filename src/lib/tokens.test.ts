import { describe, expect, it } from "vitest";
import { hashToken, isTokenShape, newToken, safeNextPath } from "./tokens";

describe("tokens", () => {
  it("makes URL-safe tokens and stores only their hash", () => {
    const { token, hash } = newToken();
    expect(isTokenShape(token)).toBe(true);
    expect(hash).toBe(hashToken(token));
    expect(hash).not.toContain(token);
    expect(isTokenShape("../etc")).toBe(false);
  });
});

describe("safeNextPath", () => {
  it("allows app paths and refuses other sites", () => {
    expect(safeNextPath("/app/children/new?x=1")).toBe("/app/children/new?x=1");
    expect(safeNextPath("//evil.example")).toBe("/app");
    expect(safeNextPath("https://evil.example")).toBe("/app");
    expect(safeNextPath("/\\evil")).toBe("/app");
    expect(safeNextPath(undefined, "/app/onboarding")).toBe("/app/onboarding");
  });
});
