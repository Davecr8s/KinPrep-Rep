import { timingSafeEqual } from "node:crypto";

/** True if the request carries "Authorization: Bearer <secret>" (constant-time comparison). */
export function hasBearer(request: Request, secret: string | undefined): boolean {
  if (!secret) return false;
  const expected = `Bearer ${secret}`;
  const given = request.headers.get("authorization") ?? "";
  return (
    given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected))
  );
}
