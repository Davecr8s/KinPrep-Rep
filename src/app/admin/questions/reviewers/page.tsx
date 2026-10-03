import type { Metadata } from "next";
import { styles } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { reviewerWeeklyCounts } from "@/lib/bank/service";
import { appSql } from "@/lib/db/postgres";

export const metadata: Metadata = { title: "Reviewers" };

// Review decisions per reviewer per week (Monday to Sunday, Lagos), for paying per question.
// Approvals, edit-and-approvals and rejections count; flags and clears don't.
export default async function ReviewersPage() {
  await requireStaff("/admin/questions/reviewers");
  const rows = await reviewerWeeklyCounts(appSql(), new Date());
  return (
    <div className="flex flex-col gap-3">
      <p className={styles.hint}>
        The last 8 weeks. Every decision is in the review log with the reviewer, the question and
        the time.
      </p>
      {rows.length === 0 ? (
        <p>No reviews yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-navy-dark/70">
              <tr>
                <th className="py-2 pr-3">Week starting</th>
                <th className="py-2 pr-3">Reviewer</th>
                <th className="py-2 pr-3">Approved</th>
                <th className="py-2 pr-3">Edited and approved</th>
                <th className="py-2 pr-3">Rejected</th>
                <th className="py-2">Questions to pay for</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.week}-${r.reviewer_id}`} className="border-t border-navy/10">
                  <td className="py-2 pr-3">{r.week}</td>
                  <td className="py-2 pr-3">{r.email ?? r.reviewer_id}</td>
                  <td className="py-2 pr-3">{r.approved}</td>
                  <td className="py-2 pr-3">{r.edited}</td>
                  <td className="py-2 pr-3">{r.rejected}</td>
                  <td className="py-2 font-bold">{r.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
