import type { Currency } from "@/config/pricing";

/** "£6", "$7.50", "₦2,000": minor units to a short display price. */
export function formatMoney(amountMinor: number, currency: Currency): string {
  const whole = amountMinor % 100 === 0;
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(amountMinor / 100);
}
