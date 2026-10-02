import "server-only";
import { getStudentAccess } from "@/lib/access";
import type { Access } from "@/lib/rules/access";
import { getBillingStore } from "@/lib/payments/server";

/**
 * Access for display, plus whether the coverage giving it is KinPrep's free trial. Callers must
 * already have checked the user may see this student (e.g. getChild returned it).
 */
export async function childAccess(
  studentId: string,
  now = new Date(),
): Promise<{ access: Access; onTrial: boolean }> {
  const access = await getStudentAccess(studentId, { now });
  if (access.state !== "active") return { access, onTrial: false };
  const coverages = await getBillingStore().getCoverages(studentId, now);
  const onTrial =
    coverages.some((c) => c.provider === "trial") &&
    !coverages.some((c) => c.provider !== "trial" && (c.currentPeriodEnd ?? new Date(0)) > now);
  return { access, onTrial };
}
