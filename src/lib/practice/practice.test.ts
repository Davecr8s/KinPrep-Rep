import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { LINK_TTL_MS, practiceUrl, signPracticeLink, verifyPracticeLink } from "./links";
import { CONTENT_SECURITY_POLICY, esc, page } from "./web-html";

const SECRET = "unit-test-practice-secret-0123456789";
const STUDENT = "0b9a8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d";

describe("practice links", () => {
  const issuedAt = new Date("2026-10-05T07:30:00Z");

  it("round-trip the student and the Lagos day, and last 24 hours", () => {
    const token = signPracticeLink({ studentId: STUDENT, issuedAt }, SECRET);
    expect(token).toMatch(/^[A-Za-z0-9_-]{52}$/);
    expect(verifyPracticeLink(token, SECRET, issuedAt)).toEqual({
      ok: true,
      studentId: STUDENT,
      day: "2026-10-05",
      issuedAt,
      expiresAt: new Date(issuedAt.getTime() + LINK_TTL_MS),
    });
    const lastSecond = new Date(issuedAt.getTime() + LINK_TTL_MS - 1000);
    expect(verifyPracticeLink(token, SECRET, lastSecond).ok).toBe(true);
    expect(verifyPracticeLink(token, SECRET, new Date(issuedAt.getTime() + LINK_TTL_MS))).toEqual({
      ok: false,
      reason: "expired",
      studentId: STUDENT,
    });
  });

  it("use the Lagos day, not the UTC one", () => {
    // 23:30 UTC on the 5th is 00:30 on the 6th in Lagos.
    const late = new Date("2026-10-05T23:30:00Z");
    const token = signPracticeLink({ studentId: STUDENT, issuedAt: late }, SECRET);
    expect(verifyPracticeLink(token, SECRET, late)).toMatchObject({ day: "2026-10-06" });
  });

  it("reject other secrets, any altered byte, future dates and unknown versions", () => {
    const token = signPracticeLink({ studentId: STUDENT, issuedAt }, SECRET);
    expect(verifyPracticeLink(token, "another-secret-another-secret-0123", issuedAt)).toEqual({
      ok: false,
      reason: "invalid",
    });
    const raw = Buffer.from(token, "base64url");
    for (const i of [0, 5, 18, 22, 30]) {
      const bad = Buffer.from(raw);
      bad[i] = bad[i]! ^ 1;
      expect(verifyPracticeLink(bad.toString("base64url"), SECRET, issuedAt).ok).toBe(false);
    }
    expect(verifyPracticeLink(`${token}A`, SECRET, issuedAt).ok).toBe(false);
    expect(verifyPracticeLink("../../etc/passwd", SECRET, issuedAt).ok).toBe(false);

    const future = signPracticeLink(
      { studentId: STUDENT, issuedAt: new Date(issuedAt.getTime() + 3600_000) },
      SECRET,
    );
    expect(verifyPracticeLink(future, SECRET, issuedAt)).toEqual({ ok: false, reason: "invalid" });

    // A correctly signed payload with an unknown version byte.
    const payload = Buffer.from(raw.subarray(0, 23));
    payload[0] = 2;
    const mac = createHmac("sha256", SECRET)
      .update("kinprep:practice:")
      .update(payload)
      .digest()
      .subarray(0, 16);
    const v2 = Buffer.concat([payload, mac]).toString("base64url");
    expect(verifyPracticeLink(v2, SECRET, issuedAt)).toEqual({ ok: false, reason: "invalid" });
  });

  it("need a real student id, and build the URL", () => {
    expect(() => signPracticeLink({ studentId: "ada", issuedAt }, SECRET)).toThrow(/uuid/);
    expect(practiceUrl("https://kinprep.ng/", "abc")).toBe("https://kinprep.ng/p/abc");
  });
});

describe("practice page HTML", () => {
  it("escapes text", () => {
    expect(esc(`<a href="x">'&'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;",
    );
  });

  it("allows exactly its own inline style and script, nothing else", () => {
    const html = page({ firstName: "Ada", body: "<p>Hi</p>" });
    const style = html.match(/<style>([\s\S]*?)<\/style>/)![1]!;
    const script = html.match(/<script>([\s\S]*?)<\/script>/)![1]!;
    const sha = (s: string) => `'sha256-${createHash("sha256").update(s).digest("base64")}'`;
    expect(CONTENT_SECURITY_POLICY).toContain(`style-src ${sha(style)}`);
    expect(CONTENT_SECURITY_POLICY).toContain(`script-src ${sha(script)}`);
    expect(CONTENT_SECURITY_POLICY).toContain("default-src 'none'");
    expect(CONTENT_SECURITY_POLICY).not.toContain("unsafe-inline");
    // No other scripts, stylesheets, fonts or images to download.
    expect(html).not.toMatch(/<script src|<link rel="stylesheet"|<img /);
    expect(Buffer.byteLength(html)).toBeLessThan(10_000);
  });
});
