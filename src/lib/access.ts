import "server-only";
import { evaluateAccess, type Access } from "@/lib/rules/access";
import { getBillingStore } from "@/lib/payments/server";
import type { BillingStore } from "@/lib/payments/types";

type Options = { now?: Date; store?: Pick<BillingStore, "getCoverages"> };

/** Access state for a student, with when it ends. Used for messages like "renew by Friday". */
export async function getStudentAccess(studentId: string, options: Options = {}): Promise<Access> {
  const now = options.now ?? new Date();
  const store = options.store ?? getBillingStore();
  return evaluateAccess(await store.getCoverages(studentId, now), now);
}

/**
 * The single source of truth for access (CLAUDE.md). True while any subscription or bulk seat
 * covers the student, including the grace period after a failed or late payment. Everything that
 * gates practice, messages or reports calls this.
 */
export async function isStudentActive(studentId: string, options: Options = {}): Promise<boolean> {
  return (await getStudentAccess(studentId, options)).state !== "inactive";
}
