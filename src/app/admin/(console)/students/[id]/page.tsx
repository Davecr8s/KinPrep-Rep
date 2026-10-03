import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, Notice, styles } from "@/components/ui";
import { studentDetail } from "@/lib/admin/students";
import { requireAdmin } from "@/lib/auth";
import { appSql } from "@/lib/db/postgres";
import { CLASSES } from "@/lib/labels";
import { studentAction } from "../../actions";

export const metadata: Metadata = { title: "Student" };

const date = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : "–");
const DONE: Record<string, string> = {
  pause: "Paused: no practice or messages until resumed.",
  resume: "Resumed.",
  class: "Class changed.",
  merge: "Duplicate merged in and deleted.",
};

export default async function StudentPage({
  params,
  searchParams,
}: PageProps<"/admin/students/[id]">) {
  const { id } = await params;
  await requireAdmin(`/admin/students/${id}`);
  const query = await searchParams;
  const s = await studentDetail(appSql(), id, new Date());
  if (!s) notFound();
  const action = studentAction.bind(null, id);
  const error = typeof query.error === "string" ? query.error : null;
  const done = typeof query.done === "string" ? DONE[query.done] : undefined;

  return (
    <div className="flex flex-col gap-4">
      <header>
        <Link href="/admin/students" className={styles.link}>
          Students
        </Link>
        <h1 className="text-2xl font-bold text-navy-dark">
          {s.first_name} {s.last_initial}. · {s.class} · {s.exam}
        </h1>
        <p className="text-navy-dark/80">
          Born {s.birth_year} · WhatsApp {s.whatsapp_number ?? "none"} · payer{" "}
          {s.owner_email ?? s.owner_id} ({s.owner_type ?? "group buyer"}) · added{" "}
          {date(s.created_at)}
        </p>
      </header>
      {error && <Notice tone="warn">{error}</Notice>}
      {done && <Notice tone="good">{done}</Notice>}

      <div className="grid gap-3 md:grid-cols-3">
        <Card>
          <p className="font-semibold">Access</p>
          <p className="text-2xl font-bold text-navy">{s.access.state}</p>
          <p className={styles.hint}>
            {s.access.paused
              ? `Paused: ${s.paused_reason}`
              : s.access.awaitingConsent
                ? "Waiting for guardian consent"
                : s.access.until
                  ? `until ${date(s.access.until)}`
                  : ""}
          </p>
        </Card>
        <Card>
          <p className="font-semibold">Guardian consent</p>
          <p>
            {s.consent
              ? `${s.consent.event} by ${s.consent.method} on ${date(s.consent.created_at)}`
              : "None"}
          </p>
        </Card>
        <Card>
          <p className="font-semibold">Practice</p>
          <p>
            {s.practice.answered} answered, {s.practice.correct} right · last{" "}
            {date(s.practice.last_answered)}
          </p>
        </Card>
      </div>

      <Card>
        <p className="mb-2 font-semibold">Plans</p>
        {s.subscriptions.length === 0 ? (
          <p className={styles.hint}>None.</p>
        ) : (
          <ul className="text-sm">
            {s.subscriptions.map((sub) => (
              <li key={sub.id}>
                {sub.provider} · {sub.plan} · {sub.currency} · {sub.status} · until{" "}
                {date(sub.current_period_end ?? sub.trial_end)}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-3 md:grid-cols-2">
        <Card>
          {s.paused_at ? (
            <form action={action} className="flex flex-col gap-2">
              <p className="font-semibold">Paused since {date(s.paused_at)}</p>
              <input type="hidden" name="action" value="resume" />
              <button className={styles.secondaryButton}>Resume practice and messages</button>
            </form>
          ) : (
            <form action={action} className="flex flex-col gap-2">
              <p className="font-semibold">Pause</p>
              <p className={styles.hint}>
                No practice and no messages while paused. Billing isn&apos;t touched.
              </p>
              <input type="hidden" name="action" value="pause" />
              <input
                name="reason"
                required
                minLength={3}
                maxLength={300}
                placeholder="Why (e.g. family holiday)"
                className={styles.input}
              />
              <button className={styles.secondaryButton}>Pause</button>
            </form>
          )}
        </Card>
        <Card>
          <form action={action} className="flex flex-col gap-2">
            <p className="font-semibold">Change class</p>
            <input type="hidden" name="action" value="class" />
            <select name="class" defaultValue={s.class} className={styles.input}>
              {CLASSES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <button className={styles.secondaryButton}>Change class</button>
          </form>
        </Card>
        <Card>
          <form action={action} className="flex flex-col gap-2">
            <p className="font-semibold">Merge a duplicate into this student</p>
            <p className={styles.hint}>
              The duplicate&apos;s practice, encouragements and messages move here; the duplicate is
              deleted.
            </p>
            <input type="hidden" name="action" value="merge" />
            <select name="duplicate" required className={styles.input} defaultValue="">
              <option value="" disabled>
                Choose the duplicate
              </option>
              {s.siblings.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.first_name} {d.last_initial}. ({d.class})
                </option>
              ))}
            </select>
            <button className={styles.secondaryButton} disabled={s.siblings.length === 0}>
              Merge
            </button>
          </form>
        </Card>
        <Card>
          <p className="font-semibold">Data rights</p>
          <a href={`/admin/students/${id}/export`} className={`${styles.link} mt-1 block`}>
            Export all their data (JSON)
          </a>
          <form action={action} className="mt-3 flex flex-col gap-2">
            <input type="hidden" name="action" value="delete" />
            <p className={styles.hint}>
              Deletes the student and everything about them; renewing plans are cancelled first.
            </p>
            <input
              name="confirm"
              required
              placeholder="Type DELETE"
              aria-label="Type DELETE to confirm"
              className={styles.input}
            />
            <button className={styles.dangerButton}>Delete student</button>
          </form>
        </Card>
      </div>
    </div>
  );
}
