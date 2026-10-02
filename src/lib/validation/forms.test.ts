import { describe, expect, it } from "vitest";
import { normalizePhone } from "@/lib/phone";
import {
  childSchema,
  fieldErrors,
  GuardianSchema,
  OnboardingSchema,
  ReportSettingsSchema,
} from "./forms";

const now = new Date("2026-10-02T12:00:00Z");

const child = (overrides: Record<string, unknown> = {}) => ({
  firstName: " Ada ",
  lastInitial: "okafor",
  class: "SS2",
  birthYear: "2010",
  exam: "WASSCE",
  subjects: ["english", "mathematics"],
  language: "pcm",
  whatsapp: "0803 123 4567",
  ...overrides,
});

describe("normalizePhone", () => {
  it("turns local and international formats into E.164", () => {
    expect(normalizePhone("0803 123 4567")).toBe("+2348031234567");
    expect(normalizePhone("2348031234567")).toBe("+2348031234567");
    expect(normalizePhone("+44 7700 900123", "GB")).toBe("+447700900123");
    expect(normalizePhone("07700 900123", "GB")).toBe("+447700900123");
    expect(normalizePhone("001 415 555 0100")).toBe("+14155550100");
    expect(normalizePhone("4155550100", "US")).toBe("+4155550100");
  });

  it("rejects things that aren't phone numbers", () => {
    expect(normalizePhone("0803 123")).toBeNull();
    expect(normalizePhone("hello")).toBeNull();
    expect(normalizePhone("+234803123456789")).toBeNull();
  });
});

describe("child form", () => {
  const parse = (o: Record<string, unknown> = {}) => childSchema(now).safeParse(child(o));

  it("cleans up a senior's details", () => {
    const result = parse();
    expect(result.success && result.data).toMatchObject({
      firstName: "Ada",
      lastInitial: "O",
      birthYear: 2010,
      whatsapp: "+2348031234567",
      senior: true,
      examDate: null,
    });
  });

  it("refuses a WhatsApp number for a child who may be under 13", () => {
    const result = parse({ class: "JSS1", exam: "BECE", birthYear: "2014" });
    expect(!result.success && fieldErrors(result.error).whatsapp).toMatch(/under 13/);
    const ok = parse({ class: "JSS1", exam: "BECE", birthYear: "2014", whatsapp: "" });
    expect(ok.success && ok.data).toMatchObject({ senior: false, whatsapp: null });
  });

  it("needs English plus three for JAMB, and matching class and exam", () => {
    const jamb = parse({ class: "UTME", exam: "UTME", subjects: ["english", "physics"] });
    expect(!jamb.success && fieldErrors(jamb.error).subjects).toMatch(/three/);
    expect(!parse({ class: "SS3", exam: "BECE" }).success).toBe(true);
    expect(!parse({ class: "JSS2", exam: "WASSCE", birthYear: "2013", whatsapp: "" }).success).toBe(
      true,
    );
    expect(!parse({ class: "UTME", exam: "WASSCE" }).success).toBe(true);
  });

  it("checks names, years, dates and phone numbers", () => {
    const errors = (o: Record<string, unknown>) => {
      const r = parse(o);
      return r.success ? {} : fieldErrors(r.error);
    };
    expect(errors({ firstName: "" }).firstName).toBeDefined();
    expect(errors({ lastInitial: "1" }).lastInitial).toBeDefined();
    expect(errors({ birthYear: "2020" }).birthYear).toMatch(/secondary/);
    expect(errors({ examDate: "2020-01-01" }).examDate).toMatch(/past/);
    expect(errors({ examDate: "not a date" }).examDate).toBeDefined();
    expect(errors({ whatsapp: "12" }).whatsapp).toMatch(/WhatsApp/);
    expect(parse({ examDate: "2027-05-10" }).data?.examDate).toBe("2027-05-10");
  });
});

describe("guardian step", () => {
  it("needs the consent tick from a guardian, nothing from a non-guardian", () => {
    expect(GuardianSchema.safeParse({ isGuardian: "yes", consent: "on" }).success).toBe(true);
    expect(GuardianSchema.safeParse({ isGuardian: "yes" }).success).toBe(false);
    expect(GuardianSchema.safeParse({ isGuardian: "no" }).success).toBe(true);
    expect(GuardianSchema.safeParse({}).success).toBe(false);
  });
});

describe("onboarding", () => {
  it("derives region and currency from payer type", () => {
    const parent = OnboardingSchema.parse({
      payerType: "parent",
      timezone: "Africa/Lagos",
      whatsapp: "08031234567",
      reportsOptIn: "on",
    });
    expect(parent).toMatchObject({
      region: "nigeria",
      currency: "NGN",
      whatsapp: "+2348031234567",
      reportsOptIn: true,
    });
    const sponsor = OnboardingSchema.parse({
      payerType: "sponsor",
      currency: "CAD",
      timezone: "America/Toronto",
    });
    expect(sponsor).toMatchObject({
      region: "abroad",
      currency: "CAD",
      reportsOptIn: false,
      whatsapp: undefined,
    });
    expect(
      OnboardingSchema.parse({ payerType: "group", currency: "USD", timezone: "Europe/London" })
        .currency,
    ).toBe("GBP");
  });

  it("needs an explicit tick and a number for WhatsApp reports, and a real timezone", () => {
    expect(
      OnboardingSchema.safeParse({
        payerType: "sponsor",
        timezone: "Europe/London",
        reportsOptIn: "on",
      }).success,
    ).toBe(false);
    expect(
      OnboardingSchema.safeParse({
        payerType: "sponsor",
        timezone: "Europe/London",
        whatsapp: "xx",
      }).success,
    ).toBe(false);
    expect(
      OnboardingSchema.safeParse({ payerType: "sponsor", timezone: "Mars/Base" }).success,
    ).toBe(false);
  });
});

describe("report settings", () => {
  it("validates day, hour and the WhatsApp opt-in", () => {
    expect(
      ReportSettingsSchema.parse({ reportWeekday: "0", reportHour: "18", country: "GB" }),
    ).toEqual({
      reportWeekday: 0,
      reportHour: 18,
      whatsapp: null,
      reportsOptIn: false,
    });
    expect(ReportSettingsSchema.safeParse({ reportWeekday: "7", reportHour: "18" }).success).toBe(
      false,
    );
    expect(
      ReportSettingsSchema.safeParse({ reportWeekday: "0", reportHour: "9", reportsOptIn: "on" })
        .success,
    ).toBe(false);
    expect(
      ReportSettingsSchema.safeParse({ reportWeekday: "0", reportHour: "9", whatsapp: "nope" })
        .success,
    ).toBe(false);
  });
});
