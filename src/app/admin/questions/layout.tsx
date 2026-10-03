import type { Metadata } from "next";
import Link from "next/link";
import { requireStaff } from "@/lib/auth";

export const metadata: Metadata = {
  title: { default: "Question bank", template: "%s · Question bank" },
  robots: { index: false, follow: false },
};

const TABS = [
  ["/admin/questions", "Bank health"],
  ["/admin/questions/review", "Review queue"],
  ["/admin/questions/bank", "Questions"],
  ["/admin/questions/new", "New question"],
  ["/admin/questions/syllabus", "Syllabus"],
  ["/admin/questions/csv", "CSV"],
  ["/admin/questions/reviewers", "Reviewers"],
] as const;

// The question bank, for admins and reviewers (reviewers see only this part of /admin).
export default async function QuestionBankLayout({ children }: LayoutProps<"/admin/questions">) {
  const staff = await requireStaff("/admin/questions");
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 py-6">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-navy uppercase">
            {staff.role === "admin" ? "Admin" : "Reviewer"}
          </p>
          <h1 className="text-2xl font-bold text-navy-dark">Question bank</h1>
        </div>
        <p className="text-sm text-navy-dark/70">
          Only approved questions are ever sent to students.
        </p>
      </header>
      <nav aria-label="Question bank" className="flex flex-wrap gap-2 border-b border-navy/10 pb-3">
        {TABS.map(([href, label]) => (
          <Link
            key={href}
            href={href}
            className="rounded-full border border-navy/20 px-3 py-1 text-sm font-semibold text-navy hover:bg-navy/5"
          >
            {label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
