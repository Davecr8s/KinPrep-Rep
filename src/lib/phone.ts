/**
 * Normalises a phone number as people type it into E.164 (+2348012345678), or null if it can't
 * be one. Nigerian local numbers (080..., 0701...) are the common case.
 */
export function normalizePhone(
  input: string,
  defaultCountry: "NG" | "GB" | "US" | "CA" = "NG",
): string | null {
  const compact = input.replace(/[\s\-().]/g, "");
  let e164: string;
  if (compact.startsWith("+")) e164 = compact;
  else if (compact.startsWith("00")) e164 = `+${compact.slice(2)}`;
  else if (compact.startsWith("234")) e164 = `+${compact}`;
  else if (compact.startsWith("0")) {
    const prefix = { NG: "+234", GB: "+44", US: "+1", CA: "+1" }[defaultCountry];
    e164 = `${prefix}${compact.slice(1)}`;
  } else e164 = `+${compact}`;
  if (!/^\+[1-9][0-9]{7,14}$/.test(e164)) return null;
  // Nigerian mobiles are +234 followed by 10 digits.
  if (e164.startsWith("+234") && e164.length !== 14) return null;
  return e164;
}
