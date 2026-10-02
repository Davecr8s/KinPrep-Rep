import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AccessBadge } from "@/components/access-badge";
import { ButtonLink, Card, PageTitle } from "@/components/ui";
import { requirePayer } from "@/lib/auth";
import { listChildren } from "@/lib/data/children";
import { childAccess } from "@/lib/data/status";
import { EXAM_LABELS } from "@/lib/labels";

export const metadata: Metadata = { title: "Your children" };

export default async function AppHome() {
  const { user, payer } = await requirePayer();
  if (payer.payer_type === "group") redirect("/app/groups");
  const children = await listChildren();
  if (children.length === 0) redirect("/app/children/new");
  const statuses = await Promise.all(children.map((c) => childAccess(c.id)));

  return (
    <>
      <PageTitle>Your children</PageTitle>
      <ul className="flex flex-col gap-3">
        {children.map((child, i) => (
          <li key={child.id}>
            <Link href={`/app/children/${child.id}`} className="block">
              <Card className="hover:border-navy/40">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xl font-bold text-navy-dark">
                      {child.first_name} {child.last_initial}.
                    </p>
                    <p className="text-navy-dark/70">
                      {child.class} · {EXAM_LABELS[child.exam]}
                      {child.owner_id !== user.id && " · co-sponsor"}
                    </p>
                  </div>
                  <span aria-hidden className="text-2xl text-navy">
                    ›
                  </span>
                </div>
                <div className="mt-3">
                  <AccessBadge {...statuses[i]!} timeZone={payer.timezone} />
                </div>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
      <div className="mt-6">
        <ButtonLink href="/app/children/new" variant="secondary">
          + Add another child
        </ButtonLink>
      </div>
    </>
  );
}
