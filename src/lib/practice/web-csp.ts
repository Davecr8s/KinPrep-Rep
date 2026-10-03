import { createHash } from "node:crypto";
import { CSS, SCRIPT } from "./web-html";

const hash = (s: string) => `'sha256-${createHash("sha256").update(s).digest("base64")}'`;

/** Only the practice page's own inline style and script may run; nothing loads from elsewhere. */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  `style-src ${hash(CSS)}`,
  `script-src ${hash(SCRIPT)}`,
  "connect-src 'self'",
  "form-action 'self'",
  "img-src data:",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join("; ");
