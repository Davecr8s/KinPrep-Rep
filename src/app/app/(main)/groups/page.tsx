import type { Metadata } from "next";
import Link from "next/link";
import { Card, FieldError, Notice, PageTitle, styles, whatsappShareUrl } from "@/components/ui";
import { PLANS } from "@/config/pricing";
import { requirePayer } from "@/lib/auth";
import { listChildren } from "@/lib/data/children";
import { serverEnv } from "@/lib/env";
import { formatMoney } from "@/lib/money";
import { myGroup, seatedStudentIds, seatSummary, weekLeaderboard } from "@/lib/services/groups";
import { isTokenShape } from "@/lib/tokens";
import { buySeats, createGroup, giveSeat, makeInviteLink } from "./actions";

export const metadata: Metadata = { title: "My group" };

const SEAT_PRICE = formatMoney(PLANS.bulk_seat_monthly.prices.GBP, "GBP");

export default async function GroupsPage({ searchParams }: PageProps<"/app/groups">) {
  const { payer } = await requirePayer();
  const query = await searchParams;
  const error = typeof query.error === "string" ? query.error : null;
  const group = await myGroup();

  if (!group) {
    return (
      <>
        <PageTitle
          sub={`Buy seats at ${SEAT_PRICE} per student per month and share one link with your students.`}
        >
          Set up your group
        </PageTitle>
        <form action={createGroup} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1">
            <span className={styles.label}>Group name</span>
            <input
              name="name"
              required
              maxLength={120}
              placeholder="Grace Chapel Youth"
              className={styles.input}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={styles.label}>Type</span>
            <select name="kind" defaultValue="church" className={styles.input}>
              <option value="church">Church</option>
              <option value="school">School</option>
              <option value="alumni">Alumni association</option>
              <option value="other">Other</option>
            </select>
          </label>
          <FieldError message={error === "group" ? "Enter a name for your group." : undefined} />
          <button className={styles.primaryButton}>Create group</button>
        </form>
      </>
    );
  }

  const [seats, students, leaderboard] = await Promise.all([
    seatSummary(group.id),
    listChildren({ inGroup: group.id }),
    weekLeaderboard(group.id),
  ]);
  const seated = await seatedStudentIds(seats.subscriptionId);
  const invite =
    typeof query.invite === "string" && isTokenShape(query.invite) ? query.invite : null;
  const inviteUrl = invite ? `${serverEnv("app").NEXT_PUBLIC_APP_URL}/join/${invite}` : null;
  const until = seats.until?.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: payer.timezone,
  });

  return (
    <div className="flex flex-col gap-6">
      <PageTitle>{group.name}</PageTitle>
      {query.paid === "1" && (
        <Notice tone="good">Payment received. Your seats will appear in a moment.</Notice>
      )}

      <Card id="seats">
        <h2 className="text-lg font-bold">Seats</h2>
        <p className="mt-1 text-2xl font-bold text-navy-dark">
          {seats.used} of {seats.seats} in use
        </p>
        <p className="text-navy-dark/70">
          {seats.seats === 0
            ? "No seats yet."
            : seats.active
              ? `Paid until ${until}.`
              : "Seats have lapsed. Renew to keep students practising."}
        </p>
        <form action={buySeats.bind(null, group.id)} className="mt-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className={styles.label}>
              {seats.seats === 0 ? "How many students?" : "Total seats you need"}
            </span>
            <input
              name="seats"
              type="number"
              min={1}
              max={500}
              defaultValue={Math.max(seats.seats, 10)}
              className={styles.input}
            />
            <span className={styles.hint}>{SEAT_PRICE} per seat per month, by card.</span>
          </label>
          <FieldError
            message={
              error === "seats"
                ? "Choose between 1 and 500 seats."
                : error === "checkout"
                  ? "We couldn't open the payment page. Try again shortly."
                  : undefined
            }
          />
          <button className={styles.primaryButton}>
            {seats.seats === 0 ? "Buy seats" : "Buy seats"}
          </button>
        </form>
      </Card>

      <Card id="invite">
        <h2 className="text-lg font-bold">Invite students</h2>
        <p className="mt-1 text-navy-dark/80">
          Share one link with your students&apos; parents. Each child joins with a parent&apos;s
          consent and takes a free seat.
        </p>
        {inviteUrl ? (
          <div className="mt-3 flex flex-col gap-3">
            <a
              className={styles.primaryButton}
              href={whatsappShareUrl(
                `Join ${group.name} on KinPrep for daily exam practice: ${inviteUrl}`,
              )}
              target="_blank"
              rel="noopener noreferrer"
            >
              Share on WhatsApp
            </a>
            <input
              readOnly
              value={inviteUrl}
              aria-label="Invite link"
              className={`${styles.input} text-sm`}
            />
            <p className={styles.hint}>
              We only show this link once. Making a new one stops the old one working.
            </p>
          </div>
        ) : (
          <form action={makeInviteLink.bind(null, group.id)} className="mt-3">
            <button className={styles.secondaryButton}>Get invite link</button>
          </form>
        )}
      </Card>

      <Card>
        <h2 className="text-lg font-bold">This week&apos;s leaderboard</h2>
        {leaderboard.length === 0 ? (
          <p className="mt-2 text-navy-dark/70">No students yet.</p>
        ) : (
          <table className="mt-2 w-full text-left">
            <thead>
              <tr className="text-sm text-navy-dark/70">
                <th className="py-1 font-semibold">#</th>
                <th className="py-1 font-semibold">Student</th>
                <th className="py-1 text-right font-semibold">Days</th>
                <th className="py-1 text-right font-semibold">Questions</th>
              </tr>
            </thead>
            <tbody>
              {leaderboard.map((row, i) => (
                <tr key={row.studentId} className="border-t border-navy/10">
                  <td className="py-2 text-navy-dark/60">{i + 1}</td>
                  <td className="py-2 font-semibold">{row.name}</td>
                  <td className="py-2 text-right">{row.practiceDays}/7</td>
                  <td className="py-2 text-right">{row.answered}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card id="students">
        <h2 className="text-lg font-bold">Students</h2>
        {error === "full" && <FieldError message="All seats are in use. Buy more seats first." />}
        <ul className="mt-2 flex flex-col divide-y divide-navy/10">
          {students.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 py-3">
              <Link
                href={`/app/children/${s.id}`}
                className="font-semibold text-navy underline-offset-2 hover:underline"
              >
                {s.first_name} {s.last_initial}.{" "}
                <span className="font-normal text-navy-dark/70">· {s.class}</span>
              </Link>
              {seated.has(s.id) ? (
                <span className="text-sm text-green-800">Seat ✓</span>
              ) : (
                <form action={giveSeat.bind(null, s.id)}>
                  <button className={styles.link}>Give a seat</button>
                </form>
              )}
            </li>
          ))}
          {students.length === 0 && (
            <li className="py-3 text-navy-dark/70">
              Nobody has joined yet. Share your invite link.
            </li>
          )}
        </ul>
      </Card>
    </div>
  );
}
