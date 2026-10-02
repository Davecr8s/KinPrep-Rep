import type { Metadata } from "next";
import Link from "next/link";
import { Card, FieldError, Notice, PageTitle, styles, whatsappShareUrl } from "@/components/ui";
import { PLANS, type PlanId } from "@/config/pricing";
import { requirePayer } from "@/lib/auth";
import { childSubscriptions, listChildren, type SubscriptionSummary } from "@/lib/data/children";
import { serverEnv } from "@/lib/env";
import { hourLabel, WEEKDAYS } from "@/lib/labels";
import { PLAN_LABELS } from "@/lib/payments/plans";
import { userDb } from "@/lib/supabase/server";
import { isTokenShape } from "@/lib/tokens";
import { signOut } from "../../sign-in/actions";
import {
  deleteChild,
  inviteCoSponsor,
  openBillingPortal,
  removeCoSponsors,
  updateReportSettings,
} from "./actions";

export const metadata: Metadata = { title: "Settings" };

const PROVIDER_NAMES = {
  stripe: "Card (Stripe)",
  paystack: "Paystack",
  manual: "Bank transfer",
  trial: "Free trial",
};

function describe(s: SubscriptionSummary, timeZone: string): string {
  const end = s.trial_end ?? s.current_period_end;
  const date = end
    ? new Date(end).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone,
      })
    : null;
  if (s.provider === "trial") return `Free trial${date ? ` until ${date}` : ""}`;
  const plan = s.plan in PLANS ? PLAN_LABELS[s.plan as PlanId] : s.plan;
  if (s.status === "canceled" || s.cancel_at_period_end)
    return `${plan}: cancelled${date ? `, ends ${date}` : ""}`;
  if (s.status === "past_due") return `${plan}: payment failed, please update your card`;
  if (s.status === "trialing") return `${plan}: trial${date ? ` until ${date}` : ""}`;
  return `${plan}${date ? `: renews or ends ${date}` : ""}`;
}

export default async function SettingsPage({ searchParams }: PageProps<"/app/settings">) {
  const { user, payer } = await requirePayer();
  const query = await searchParams;
  const children = (await listChildren()).filter((c) => c.owner_id === user.id);
  const db = await userDb();
  const details = await Promise.all(
    children.map(async (c) => {
      const [subs, viewers] = await Promise.all([
        childSubscriptions(c.id),
        db
          .from("student_viewers")
          .select("viewer_id", { count: "exact", head: true })
          .eq("student_id", c.id),
      ]);
      return { child: c, subs, viewerCount: viewers.count ?? 0 };
    }),
  );
  const invite =
    typeof query.invite === "string" && isTokenShape(query.invite) ? query.invite : null;
  const inviteChild = children.find((c) => c.id === query.child);
  const inviteUrl =
    invite && inviteChild ? `${serverEnv("app").NEXT_PUBLIC_APP_URL}/app/invite/${invite}` : null;
  const error = typeof query.error === "string" ? query.error : null;

  return (
    <div className="flex flex-col gap-6">
      <PageTitle>Settings</PageTitle>
      {query.saved === "deleted" && (
        <Notice tone="good">Deleted. That child&apos;s data has been removed from KinPrep.</Notice>
      )}

      <Card id="billing">
        <h2 className="text-lg font-bold">Billing</h2>
        {details.length === 0 && <p className="mt-2 text-navy-dark/70">No children yet.</p>}
        <ul className="mt-2 flex flex-col divide-y divide-navy/10">
          {details.map(({ child, subs }) => {
            const live = subs.filter((s) => s.status !== "incomplete");
            return (
              <li key={child.id} className="py-3">
                <p className="font-semibold">{child.first_name}</p>
                {live.length === 0 && <p className="text-navy-dark/70">No plan yet.</p>}
                <ul className="mt-1 flex flex-col gap-2">
                  {live.slice(0, 3).map((s) => (
                    <li key={s.id} className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        <span className="block">{describe(s, payer.timezone)}</span>
                        <span className="text-sm text-navy-dark/60">
                          {PROVIDER_NAMES[s.provider]}
                        </span>
                      </span>
                      {(s.provider === "stripe" || s.provider === "paystack") &&
                        s.provider_subscription_id && (
                          <form action={openBillingPortal.bind(null, s.id)}>
                            <button className={styles.link}>Change card or cancel</button>
                          </form>
                        )}
                    </li>
                  ))}
                </ul>
                <Link
                  href={`/app/children/${child.id}/plan`}
                  className={`${styles.link} mt-2 inline-block`}
                >
                  Choose or change plan
                </Link>
              </li>
            );
          })}
        </ul>
        {error === "portal" && (
          <FieldError message="That billing page isn't available yet. Please try again later." />
        )}
      </Card>

      <Card id="reports">
        <h2 className="text-lg font-bold">Weekly report</h2>
        {query.saved === "reports" && (
          <div className="mt-2">
            <Notice tone="good">Saved.</Notice>
          </div>
        )}
        <form action={updateReportSettings} className="mt-3 flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className={styles.label}>Day</span>
              <select
                name="reportWeekday"
                defaultValue={payer.report_weekday}
                className={styles.input}
              >
                {WEEKDAYS.map((d, i) => (
                  <option key={d} value={i}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className={styles.label}>Time</span>
              <select name="reportHour" defaultValue={payer.report_hour} className={styles.input}>
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {hourLabel(h)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className={styles.hint}>In your timezone ({payer.timezone.replaceAll("_", " ")}).</p>
          <label className="flex flex-col gap-1">
            <span className={styles.label}>Your WhatsApp number</span>
            <input
              name="whatsapp"
              type="tel"
              defaultValue={payer.whatsapp_number ?? ""}
              className={styles.input}
            />
            <FieldError
              message={
                error === "whatsapp"
                  ? "Check the number, and add one if reports go to WhatsApp."
                  : undefined
              }
            />
          </label>
          <label className="flex cursor-pointer gap-3">
            <input
              type="checkbox"
              name="reportsOptIn"
              defaultChecked={payer.whatsapp_reports_opt_in_at !== null}
              className="mt-1 size-5 shrink-0 accent-navy"
            />
            <span>Send the weekly report to me on WhatsApp</span>
          </label>
          <button className={styles.secondaryButton}>Save</button>
        </form>
      </Card>

      <Card id="sharing">
        <h2 className="text-lg font-bold">Co-sponsors</h2>
        <p className="mt-1 text-navy-dark/80">
          Let someone else who supports your child see their progress. They can&apos;t change
          anything or see billing.
        </p>
        {inviteUrl && inviteChild && (
          <div className="mt-3 flex flex-col gap-3 rounded-lg bg-navy/5 p-3">
            <p className="font-semibold">Send this link (it works for 7 days, once):</p>
            <a
              className={styles.primaryButton}
              href={whatsappShareUrl(
                `Follow ${inviteChild.first_name}'s exam practice on KinPrep: ${inviteUrl}`,
              )}
              target="_blank"
              rel="noopener noreferrer"
            >
              Send on WhatsApp
            </a>
            <input
              readOnly
              value={inviteUrl}
              aria-label="Invite link"
              className={`${styles.input} text-sm`}
            />
          </div>
        )}
        {query.saved === "sharing" && (
          <div className="mt-2">
            <Notice tone="good">Co-sponsors removed.</Notice>
          </div>
        )}
        <ul className="mt-3 flex flex-col divide-y divide-navy/10">
          {details.map(({ child, viewerCount }) => (
            <li key={child.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <span>
                <span className="block font-semibold">{child.first_name}</span>
                <span className="text-sm text-navy-dark/70">
                  {viewerCount === 0
                    ? "No co-sponsors"
                    : `${viewerCount} co-sponsor${viewerCount === 1 ? "" : "s"}`}
                </span>
              </span>
              <span className="flex gap-4">
                {viewerCount > 0 && (
                  <form action={removeCoSponsors.bind(null, child.id)}>
                    <button className={styles.link}>Remove</button>
                  </form>
                )}
                <form action={inviteCoSponsor.bind(null, child.id)}>
                  <button className={styles.link}>Invite</button>
                </form>
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <Card id="data">
        <h2 className="text-lg font-bold">Your child&apos;s data</h2>
        <p className="mt-1 text-navy-dark/80">
          Download everything we hold, or delete it for good.
        </p>
        {error === "billing" && (
          <div className="mt-2">
            <Notice tone="warn">
              We couldn&apos;t cancel the card subscription, so nothing was deleted. Please try
              again shortly.
            </Notice>
          </div>
        )}
        <ul className="mt-3 flex flex-col divide-y divide-navy/10">
          {details.map(({ child }) => (
            <li key={child.id} className="py-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{child.first_name}</span>
                <a href={`/app/children/${child.id}/export`} className={styles.link}>
                  Download data
                </a>
              </div>
              <details className="mt-2">
                <summary className="cursor-pointer text-red-700">
                  Delete {child.first_name}&apos;s data
                </summary>
                <form
                  action={deleteChild.bind(null, child.id)}
                  className="mt-3 flex flex-col gap-3"
                >
                  <p>
                    This cancels {child.first_name}&apos;s plan, stops all practice and permanently
                    deletes their details and answers. It can&apos;t be undone. Type{" "}
                    <strong>{child.first_name}</strong> to confirm.
                  </p>
                  <input
                    name="confirm"
                    autoComplete="off"
                    className={styles.input}
                    aria-label={`Type ${child.first_name} to confirm`}
                  />
                  <FieldError
                    message={
                      error === "confirm" && query.child === child.id
                        ? "The name didn't match."
                        : undefined
                    }
                  />
                  <button className={styles.dangerButton}>Delete permanently</button>
                </form>
              </details>
            </li>
          ))}
        </ul>
      </Card>

      <form action={signOut}>
        <button className={`${styles.secondaryButton} w-full`}>Sign out</button>
      </form>
    </div>
  );
}
