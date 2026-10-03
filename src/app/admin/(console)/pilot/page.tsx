import type { Metadata } from "next";
import { Card, Notice, styles } from "@/components/ui";
import { pilotQueue } from "@/lib/admin/console";
import { requireAdmin } from "@/lib/auth";
import { appSql } from "@/lib/db/postgres";
import { markSentAction, preparePilotAction } from "../actions";

export const metadata: Metadata = { title: "Pilot console" };

const GROUPS = [
  {
    job: "practice_link",
    manual: "practice-links",
    title: "Today's practice links",
    button: "Make today's practice links",
  },
  {
    job: "weekly_report",
    manual: "weekly-reports",
    title: "Weekly reports",
    button: "Make this week's reports",
  },
  {
    job: "missed_days",
    manual: "missed-days",
    title: "Missed-day alerts",
    button: "Make missed-day alerts",
  },
] as const;

// Running the pilot before the WhatsApp Cloud API is live: each message opens in WhatsApp
// (wa.me) ready to send from the WhatsApp Business app in one tap, then gets marked as sent.
// Same dedupe keys as the scheduled jobs, so nothing goes twice when the Cloud API takes over.
export default async function PilotConsolePage({ searchParams }: PageProps<"/admin/pilot">) {
  await requireAdmin("/admin/pilot");
  const query = await searchParams;
  const items = await pilotQueue(appSql(), new Date());

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-bold text-navy-dark">Pilot console</h1>
      <p className="text-navy-dark/80">
        Tap “Send on WhatsApp” to open the message in WhatsApp Business, send it, then tap “Mark as
        sent”. Juniors&apos; links go to the parent, never the child.
      </p>
      {typeof query.done === "string" && <Notice tone="good">{query.done}</Notice>}
      {typeof query.error === "string" && <Notice tone="warn">{query.error}</Notice>}

      {GROUPS.map((g) => {
        const group = items.filter((i) => i.job === g.job);
        const waiting = group.filter((i) => i.status === "manual");
        return (
          <section key={g.job} aria-labelledby={g.job}>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 id={g.job} className="text-lg font-bold text-navy-dark">
                {g.title} ({waiting.length} to send, {group.length - waiting.length} sent)
              </h2>
              <form action={preparePilotAction.bind(null, g.manual)}>
                <button className={styles.primaryButton}>{g.button}</button>
              </form>
            </div>
            <ul className="flex flex-col gap-2">
              {group.map((i) => (
                <li key={i.id}>
                  <Card
                    className={`flex flex-col gap-2 ${i.status === "sent" ? "opacity-60" : ""}`}
                  >
                    <p className="text-sm font-semibold">
                      {i.about ?? "–"} → {i.recipient}
                      {i.status === "sent" &&
                        ` · sent ${i.sent_at ? new Date(i.sent_at).toLocaleTimeString("en-GB", { timeZone: "Africa/Lagos" }) : ""} by ${i.sent_by_email ?? "admin"}`}
                    </p>
                    <p className="text-sm whitespace-pre-wrap text-navy-dark/80">{i.text}</p>
                    {i.status === "manual" && (
                      <div className="flex flex-wrap gap-2">
                        <a
                          href={i.link}
                          target="_blank"
                          rel="noreferrer"
                          className={styles.secondaryButton}
                        >
                          {i.channel === "whatsapp" ? "Send on WhatsApp" : "Send by email"}
                        </a>
                        <form action={markSentAction.bind(null, i.id)}>
                          <button className={styles.secondaryButton}>Mark as sent</button>
                        </form>
                      </div>
                    )}
                  </Card>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
