import { audit, adminMember } from "@/lib/admin/common";
import { requireAdmin } from "@/lib/auth";
import { appSql } from "@/lib/db/postgres";
import { exportStudentData } from "@/lib/services/data-rights";

// An admin downloads everything KinPrep holds about a student (e.g. for a data request).
export async function GET(
  _request: Request,
  { params }: RouteContext<"/admin/students/[id]/export">,
) {
  const { id } = await params;
  const user = await requireAdmin(`/admin/students/${id}`);
  const admin = await adminMember(appSql(), user.id);
  const data = await exportStudentData(id, user.id);
  await audit(appSql(), admin, "student.exported", "student", id);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="kinprep-student-${id}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
