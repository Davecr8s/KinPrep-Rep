import { randomBytes } from "node:crypto";

/** An unguessable sponsor link code: 128 random bits, base64url (22 characters). */
export function newSponsorCode(): string {
  return randomBytes(16).toString("base64url");
}

export function isSponsorCodeShape(code: string): boolean {
  return /^[A-Za-z0-9_-]{22,64}$/.test(code);
}

/** Normalises what a payer types as a referral code ("ada 123" -> "ADA123"); null if invalid. */
export function normalizeReferralCode(input: string): string | null {
  const code = input.replace(/\s+/g, "").toUpperCase();
  return /^[A-Z0-9]{4,16}$/.test(code) ? code : null;
}
