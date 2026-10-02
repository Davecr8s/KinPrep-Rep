import { createHash, randomBytes } from "node:crypto";

// One-time links (guardian consent, co-sponsor invites, class invites). The link carries the
// token; the database stores only its SHA-256, so a database leak can't be turned into links.

export function newToken(): { token: string; hash: string } {
  const token = randomBytes(24).toString("base64url");
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function isTokenShape(token: string): boolean {
  return /^[A-Za-z0-9_-]{32}$/.test(token);
}

/** Only allow redirects to paths inside the app, never to another site. */
export function safeNextPath(next: unknown, fallback = "/app"): string {
  return typeof next === "string" && /^\/(?!\/)[\w\-/?=&.%]*$/.test(next) ? next : fallback;
}
