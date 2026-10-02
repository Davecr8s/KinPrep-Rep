import type { Metadata } from "next";
import { Card, styles } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { appSql } from "@/lib/db/postgres";
import { serverEnv } from "@/lib/env";
import { todaysLinks, type DailyLink } from "@/lib/practice/daily-links";
import { LINK_TTL_MS } from "@/lib/practice/links";
import { generateTodaysLinks } from "./actions";

export const metadata: Metadata = {
  title: "Today's practice links",
  robots: { index: false, follow: false },
};

const PAGE = "/admin/practice-links";

/** The links issued at `at` (unix seconds), while they are still valid. */
function issuedAt(at: unknown, now: number): Date | null {
  const seconds = typeof at === "string" && /^\d{9,11}$/.test(at) ? Number(at) * 1000 : NaN;
  if (!Number.isFinite(seconds) || seconds > now + 60_000 || seconds <= now - LINK_TTL_MS) {
    return null;
  }
  return new Date(seconds);
}

function whatsappHref(phone: string, message: string): string {
  return `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(message)}`;
}

function mailtoHref(email: string, link: DailyLink): string {
  const subject = `${link.firstName}'s KinPrep practice for today`;
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(link.message)}`;
}

export default async function PracticeLinks({ searchParams }: PageProps<"/admin/practice-links">) {
  await requireAdmin(PAGE);
  const query = await searchParams;
  const at = issuedAt(query.at, new Date().getTime());
  const links = at
    ? await todaysLinks(appSql(), {
        appUrl: serverEnv("app").NEXT_PUBLIC_APP_URL,
        secret: serverEnv("practice").PRACTICE_LINK_SECRET,
        issuedAt: at,
      })
    : [];
  const juniors = links.filter((l) => l.junior).length;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 py-6">
      <header>
        <p className="text-sm font-semibold text-navy uppercase">Admin</p>
        <h1 className="text-2xl font-bold text-navy-dark">Today&apos;s practice links</h1>
        <p className="text-sm text-navy-dark/70">
          A web practice link for every active student, valid for 24 hours. Juniors&apos; links go
          to the parent or guardian, never to the child.
        </p>
      </header>

      <form action={generateTodaysLinks}>
        <button className={styles.primaryButton}>Generate today&apos;s links</button>
      </form>

      {at && (
        <>
          <p className="text-navy-dark">
            <strong>{links.length}</strong> active students ({juniors} junior,{" "}
            {links.length - juniors} senior). Issued{" "}
            {at.toLocaleString("en-GB", { timeZone: "Africa/Lagos" })} Lagos time.
          </p>
          <ul className="flex flex-col gap-3">
            {links.map((link) => (
              <li key={link.studentId}>
                <Card className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-bold text-navy-dark">
                      {link.firstName} {link.lastInitial}.{" "}
                      <span className="font-normal text-navy-dark/70">{link.class}</span>
                    </p>
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-bold ${link.junior ? "bg-orange-light text-navy-dark" : "bg-navy/10 text-navy"}`}
                    >
                      {link.junior ? "Junior: send to parent" : "Senior"}
                    </span>
                  </div>
                  <p className="text-sm text-navy-dark/80">
                    Send to {link.sendTo.who === "parent" ? "parent/guardian" : "student"}:{" "}
                    {[link.sendTo.whatsapp, link.sendTo.email].filter(Boolean).join(" · ") ||
                      "no contact details"}
                  </p>
                  <input
                    readOnly
                    value={link.url}
                    aria-label={`Practice link for ${link.firstName}`}
                    className={`${styles.input} font-mono text-sm`}
                  />
                  <div className="flex flex-wrap gap-2">
                    {link.sendTo.whatsapp && (
                      <a
                        className={styles.secondaryButton}
                        href={whatsappHref(link.sendTo.whatsapp, link.message)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Send on WhatsApp
                      </a>
                    )}
                    {link.sendTo.email && (
                      <a
                        className={styles.secondaryButton}
                        href={mailtoHref(link.sendTo.email, link)}
                      >
                        Send by email
                      </a>
                    )}
                  </div>
                </Card>
              </li>
            ))}
          </ul>
          {links.length > 0 && (
            <details>
              <summary className="cursor-pointer font-semibold text-navy">All as text</summary>
              <textarea
                readOnly
                rows={Math.min(20, links.length * 2 + 1)}
                className={`${styles.input} mt-2 font-mono text-sm`}
                value={links
                  .map(
                    (l) =>
                      `${l.firstName} ${l.lastInitial}. (${l.junior ? "junior, to parent" : "senior"}) ${[l.sendTo.whatsapp, l.sendTo.email].filter(Boolean).join(" / ")}\n${l.url}`,
                  )
                  .join("\n\n")}
              />
            </details>
          )}
        </>
      )}
    </main>
  );
}
