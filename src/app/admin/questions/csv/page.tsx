import type { Metadata } from "next";
import { Card, styles } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { CSV_COLUMNS } from "@/lib/bank/rules";
import { importAction } from "../actions";
import { ImportForm } from "./import-form";

export const metadata: Metadata = { title: "CSV import and export" };

export default async function CsvPage() {
  await requireStaff("/admin/questions/csv");
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <h2 className="text-lg font-bold text-navy-dark">Export</h2>
        <p className={`${styles.hint} mt-1`}>Opens in any spreadsheet app.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a file download, not a page */}
          <a href="/admin/questions/export?status=approved" className={styles.secondaryButton}>
            Approved questions
          </a>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a file download, not a page */}
          <a href="/admin/questions/export" className={styles.secondaryButton}>
            Every question
          </a>
        </div>
      </Card>
      <Card>
        <h2 className="text-lg font-bold text-navy-dark">Import</h2>
        <p className={`${styles.hint} mt-1`}>
          Columns as in the export ({CSV_COLUMNS.join(", ")}). Required: subject, topic, stem,
          option_a, option_b, answer (A to E) and explanation_en. Topics must already be in the
          syllabus. Every imported question starts as a draft and goes through review: nothing is
          approved by an import.
        </p>
        <div className="mt-3">
          <ImportForm action={importAction} />
        </div>
      </Card>
    </div>
  );
}
