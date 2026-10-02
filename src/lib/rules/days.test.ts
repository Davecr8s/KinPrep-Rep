import { describe, expect, it } from "vitest";
import { addDays, lagosDay, lagosDayStart, lagosYear, weekDays, weekStart } from "./days";

describe("Lagos days", () => {
  it("rolls over at Lagos midnight (23:00 UTC), not UTC midnight", () => {
    expect(lagosDay(new Date("2026-10-04T22:59:59Z"))).toBe("2026-10-04");
    expect(lagosDay(new Date("2026-10-04T23:00:00Z"))).toBe("2026-10-05");
    expect(lagosDayStart("2026-10-05")).toEqual(new Date("2026-10-04T23:00:00Z"));
  });

  it("matches the real Africa/Lagos zone all year (no daylight saving)", () => {
    const format = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" });
    for (let month = 0; month < 12; month++) {
      const instant = new Date(Date.UTC(2026, month, 15, 23, 30));
      expect(lagosDay(instant)).toBe(format.format(instant));
    }
  });

  it("starts weeks on Monday and handles month and year ends", () => {
    expect(weekStart("2026-10-04")).toBe("2026-09-28"); // Sunday -> previous Monday
    expect(weekStart("2026-10-05")).toBe("2026-10-05"); // Monday
    expect(weekDays("2026-12-28")).toEqual([
      "2026-12-28",
      "2026-12-29",
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
      "2027-01-03",
    ]);
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("gives the Lagos year, which changes at Lagos midnight on New Year's Eve", () => {
    expect(lagosYear(new Date("2026-12-31T22:59:00Z"))).toBe(2026);
    expect(lagosYear(new Date("2026-12-31T23:00:00Z"))).toBe(2027);
  });
});
