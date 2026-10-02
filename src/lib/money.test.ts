import { describe, expect, it } from "vitest";
import { formatMoney } from "./money";

describe("formatMoney", () => {
  it("drops pennies on whole amounts and keeps them otherwise", () => {
    expect(formatMoney(600, "GBP")).toBe("£6");
    expect(formatMoney(750, "USD")).toBe("$7.50");
    expect(formatMoney(200_000, "NGN")).toBe("₦2,000");
    expect(formatMoney(1100, "CAD")).toBe("$11");
  });
});
