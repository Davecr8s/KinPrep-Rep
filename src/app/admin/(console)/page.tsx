import Link from "next/link";
import { Card, styles } from "@/components/ui";
import type { Currency } from "@/config/pricing";
import { overview } from "@/lib/admin/metrics";
import { requireAdmin } from "@/lib/auth";
import { appSql } from "@/lib/db/postgres";
import { formatMoney } from "@/lib/money";

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <p className="text-sm font-semibold text-navy-dark/70">{label}</p>
      <p className="text-3xl font-bold text-navy">{value}</p>
      {hint && <p className={styles.hint}>{hint}</p>}
    </Card>
  );
}

const pct = (a: number, b: number) => (b === 0 ? "–" : `${Math.round((a / b) * 100)}%`);

export default async function OverviewPage() {
  await requireAdmin("/admin");
  const o = await overview(appSql(), new Date());
  const mrr = (c: Currency) => formatMoney(o.mrr[c] ?? 0, c);
  const others = (Object.keys(o.mrr) as Currency[]).filter((c) => c !== "GBP" && c !== "NGN");

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold text-navy-dark">Overview · {o.month}</h1>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Figure
          label="Active students"
          value={String(o.activeStudents)}
          hint="consent, not paused, plan or trial"
        />
        <Figure
          label="Payers"
          value={String(o.payersByType.sponsor + o.payersByType.parent + o.payersByType.group)}
          hint={`${o.payersByType.sponsor} sponsors · ${o.payersByType.parent} parents · ${o.payersByType.group} groups`}
        />
        <Figure label="Monthly revenue (GBP)" value={mrr("GBP")} hint="paid plans active now" />
        <Figure
          label="Monthly revenue (NGN)"
          value={mrr("NGN")}
          hint={
            others.length
              ? `also ${others.map((c) => formatMoney(o.mrr[c]!, c)).join(", ")}`
              : "paid plans active now"
          }
        />
        <Figure
          label="Trial conversions"
          value={pct(o.trials.converted, o.trials.started)}
          hint={`${o.trials.converted} of ${o.trials.started} trials went on to pay`}
        />
        <Figure
          label="Practising 5+ days a week"
          value={pct(o.practising5Days.students, o.practising5Days.of)}
          hint={`${o.practising5Days.students} of ${o.practising5Days.of} active, week of ${o.practising5Days.week}`}
        />
        <Figure label="Renewals this month" value={String(o.renewalsThisMonth)} />
        <Figure
          label="Churn this month"
          value={String(o.churn.canceled)}
          hint={`cancelled, of ${o.churn.atStart} paid plans at the start of the month (${pct(o.churn.canceled, o.churn.atStart)})`}
        />
        <Figure
          label="Messages sent this month"
          value={String(o.messages.whatsapp + o.messages.email)}
          hint={`${o.messages.whatsapp} WhatsApp · ${o.messages.email} email`}
        />
        <Figure
          label="Estimated WhatsApp cost"
          value={`$${o.messages.costUsd.toFixed(2)}`}
          hint="this month, from Meta's rate card (estimate)"
        />
      </div>
      <p className={styles.hint}>
        How each number is worked out:{" "}
        <Link href="/admin/metrics" className={styles.link}>
          pilot metrics
        </Link>{" "}
        and the definitions in <code>src/lib/admin/metrics.ts</code>.
      </p>
    </div>
  );
}
