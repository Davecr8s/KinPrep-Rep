import { createHmac, timingSafeEqual } from "node:crypto";
import { addDays, lagosDay } from "@/lib/rules/days";

// Signed practice links (/p/<token>): no login, tied to one student and one Lagos day, valid for
// 24 hours. Nothing is stored; the HMAC proves we issued it. Deleting the student kills the link.
//
// Token = base64url(payload || mac), 52 characters:
//   payload: version (1) | student uuid (16) | day as days since 2020-01-01 (2) | issued, unix s (4)
//   mac:     first 16 bytes of HMAC-SHA256(secret, "kinprep:practice:" || payload)

export const LINK_TTL_MS = 24 * 60 * 60 * 1000;
const VERSION = 1;
const PAYLOAD_BYTES = 23;
const MAC_BYTES = 16;
const EPOCH_DAY = "2020-01-01";
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PracticeLink = { studentId: string; day: string; issuedAt: Date; expiresAt: Date };

function mac(secret: string, payload: Buffer): Buffer {
  return createHmac("sha256", secret)
    .update("kinprep:practice:")
    .update(payload)
    .digest()
    .subarray(0, MAC_BYTES);
}

function dayNumber(day: string): number {
  return Math.round(
    (Date.parse(`${day}T00:00:00Z`) - Date.parse(`${EPOCH_DAY}T00:00:00Z`)) / 864e5,
  );
}

/** A link for the student's set on the Lagos day it is issued. */
export function signPracticeLink(
  input: { studentId: string; issuedAt: Date },
  secret: string,
): string {
  if (!UUID.test(input.studentId)) throw new Error("studentId must be a uuid");
  const payload = Buffer.alloc(PAYLOAD_BYTES);
  payload.writeUInt8(VERSION, 0);
  Buffer.from(input.studentId.replaceAll("-", ""), "hex").copy(payload, 1);
  payload.writeUInt16BE(dayNumber(lagosDay(input.issuedAt)), 17);
  payload.writeUInt32BE(Math.floor(input.issuedAt.getTime() / 1000), 19);
  return Buffer.concat([payload, mac(secret, payload)]).toString("base64url");
}

export type VerifyResult =
  ({ ok: true } & PracticeLink) | { ok: false; reason: "invalid" | "expired"; studentId?: string };

export function verifyPracticeLink(token: string, secret: string, now: Date): VerifyResult {
  if (!/^[A-Za-z0-9_-]{52}$/.test(token)) return { ok: false, reason: "invalid" };
  const raw = Buffer.from(token, "base64url");
  if (raw.length !== PAYLOAD_BYTES + MAC_BYTES) return { ok: false, reason: "invalid" };
  const payload = raw.subarray(0, PAYLOAD_BYTES);
  if (!timingSafeEqual(raw.subarray(PAYLOAD_BYTES), mac(secret, payload))) {
    return { ok: false, reason: "invalid" };
  }
  if (payload.readUInt8(0) !== VERSION) return { ok: false, reason: "invalid" };
  const hex = payload.subarray(1, 17).toString("hex");
  const studentId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  const day = addDays(EPOCH_DAY, payload.readUInt16BE(17));
  const issuedAt = new Date(payload.readUInt32BE(19) * 1000);
  const expiresAt = new Date(issuedAt.getTime() + LINK_TTL_MS);
  if (issuedAt.getTime() > now.getTime() + CLOCK_SKEW_MS) return { ok: false, reason: "invalid" };
  if (now >= expiresAt) return { ok: false, reason: "expired", studentId };
  return { ok: true, studentId, day, issuedAt, expiresAt };
}

export function practiceUrl(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/$/, "")}/p/${token}`;
}
