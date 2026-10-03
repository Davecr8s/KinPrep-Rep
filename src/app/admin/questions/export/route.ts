import { requireStaff } from "@/lib/auth";
import { exportCsv } from "@/lib/bank/service";
import { appSql } from "@/lib/db/postgres";

const STATUSES = ["draft", "in_review", "approved", "rejected", "retired"];

// CSV export of the question bank, for admins and reviewers.
export async function GET(request: Request) {
  await requireStaff("/admin/questions/csv");
  const requested = new URL(request.url).searchParams.get("status");
  const status = requested && STATUSES.includes(requested) ? requested : undefined;
  const csv = await exportCsv(appSql(), { status });
  const name = `kinprep-questions-${status ?? "all"}-${new Date().toISOString().slice(0, 10)}.csv`;
  // The byte-order mark makes Excel read the file as UTF-8 (naira signs, Pidgin, accents).
  return new Response(`﻿${csv}`, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${name}"`,
      "cache-control": "no-store",
    },
  });
}
