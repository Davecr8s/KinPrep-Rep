import { requireOwnedStudent } from "@/lib/auth";
import { exportStudentData } from "@/lib/services/data-rights";

// "Download my child's data" (right of access / portability).
export async function GET(
  _request: Request,
  { params }: RouteContext<"/app/children/[id]/export">,
) {
  const { id } = await params;
  const { user, firstName } = await requireOwnedStudent(id);
  const data = await exportStudentData(id, user.id);
  const filename = `kinprep-${firstName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-data.json`;
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
