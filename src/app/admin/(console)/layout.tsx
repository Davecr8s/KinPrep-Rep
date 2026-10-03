import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";

export const metadata: Metadata = {
  title: { default: "Admin", template: "%s · KinPrep admin" },
  robots: { index: false, follow: false },
};

const NAV = [
  ["/admin", "Overview"],
  ["/admin/metrics", "Pilot metrics"],
  ["/admin/students", "Students and payers"],
  ["/admin/payments", "Payments"],
  ["/admin/pilot", "Pilot console"],
  ["/admin/ambassadors", "Ambassadors"],
  ["/admin/messages", "Messages"],
  ["/admin/ai", "AI explanations"],
  ["/admin/settings", "Settings"],
  ["/admin/questions", "Question bank"],
] as const;

// The admin console: admin role only (reviewers see only /admin/questions, which has its own
// layout). Every change made here is written to audit_log.
export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  await requireAdmin("/admin");
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 py-6">
      <header>
        <p className="text-sm font-semibold text-navy uppercase">KinPrep admin</p>
      </header>
      <nav aria-label="Admin" className="flex flex-wrap gap-2 border-b border-navy/10 pb-3">
        {NAV.map(([href, label]) => (
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
