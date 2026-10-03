import type { Metadata } from "next";
import { Card, styles } from "@/components/ui";
import { TEMPLATES, type TemplateDefinition } from "@/config/templates";
import { messageLog } from "@/lib/admin/console";
import { requireAdmin } from "@/lib/auth";
import { appSql } from "@/lib/db/postgres";
import {
  compareTemplates,
  fetchMetaTemplates,
  type TemplateStatusRow,
} from "@/lib/whatsapp/template-status";

export const metadata: Metadata = { title: "Messages" };

const STATUSES = ["received", "sent", "simulated", "blocked", "failed"];

async function templateStatus(): Promise<{ rows: TemplateStatusRow[]; error: string | null }> {
  const definitions: TemplateDefinition[] = Object.values(TEMPLATES);
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const account = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
  if (!token || !account) {
    return {
      rows: compareTemplates(definitions, []),
      error: "Add WHATSAPP_ACCESS_TOKEN and WHATSAPP_BUSINESS_ACCOUNT_ID to see Meta's status.",
    };
  }
  try {
    const found = await fetchMetaTemplates({
      token,
      account,
      version: process.env.WHATSAPP_GRAPH_VERSION || "v23.0",
    });
    return { rows: compareTemplates(definitions, found), error: null };
  } catch (error) {
    return {
      rows: compareTemplates(definitions, []),
      error: String(error instanceof Error ? error.message : error),
    };
  }
}

export default async function MessagesPage({ searchParams }: PageProps<"/admin/messages">) {
  await requireAdmin("/admin/messages");
  const query = await searchParams;
  const str = (k: string) =>
    typeof query[k] === "string" && query[k] ? (query[k] as string).slice(0, 100) : undefined;
  const direction = ["in", "out"].includes(str("direction") ?? "") ? str("direction") : undefined;
  const status = STATUSES.includes(str("status") ?? "") ? str("status") : undefined;
  const days = Math.min(90, Math.max(1, Number(str("days") ?? 7) || 7));
  const [rows, templates] = await Promise.all([
    messageLog(appSql(), { direction, status, q: str("q"), template: str("template"), days }),
    templateStatus(),
  ]);

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-bold text-navy-dark">Messages</h1>
      <section aria-labelledby="templates">
        <h2 id="templates" className="mb-2 text-lg font-bold text-navy-dark">
          Templates at Meta
        </h2>
        {templates.error && <p className={`${styles.hint} mb-2`}>{templates.error}</p>}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-navy-dark/70">
              <tr>
                <th className="py-2 pr-3">Template</th>
                <th className="py-2 pr-3">We asked for</th>
                <th className="py-2 pr-3">Meta says</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2">Notes</th>
              </tr>
            </thead>
            <tbody>
              {templates.rows.map((t) => (
                <tr
                  key={t.name}
                  className={`border-t border-navy/10 ${t.reclassified ? "bg-red-50" : ""}`}
                >
                  <td className="py-2 pr-3 font-mono">{t.name}</td>
                  <td className="py-2 pr-3">{t.ours}</td>
                  <td className={`py-2 pr-3 ${t.reclassified ? "font-bold text-red-700" : ""}`}>
                    {t.meta ?? "–"}
                  </td>
                  <td className="py-2 pr-3">{t.status ?? "–"}</td>
                  <td className="py-2">{t.notes.join("; ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="log">
        <h2 id="log" className="mb-2 text-lg font-bold text-navy-dark">
          Message log
        </h2>
        <form action="/admin/messages" className="mb-2 flex flex-wrap gap-2">
          <select
            name="direction"
            defaultValue={direction ?? ""}
            aria-label="Direction"
            className={styles.input}
          >
            <option value="">In and out</option>
            <option value="in">In</option>
            <option value="out">Out</option>
          </select>
          <select
            name="status"
            defaultValue={status ?? ""}
            aria-label="Status"
            className={styles.input}
          >
            <option value="">Any status</option>
            {STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <select
            name="template"
            defaultValue={str("template") ?? ""}
            aria-label="Template"
            className={styles.input}
          >
            <option value="">Any template</option>
            {Object.values(TEMPLATES).map((t) => (
              <option key={t.name}>{t.name}</option>
            ))}
          </select>
          <input
            name="q"
            defaultValue={str("q")}
            placeholder="Number or email"
            aria-label="Number or email"
            className={styles.input}
          />
          <select
            name="days"
            defaultValue={String(days)}
            aria-label="Period"
            className={styles.input}
          >
            {[1, 7, 30, 90].map((d) => (
              <option key={d} value={d}>
                Last {d} {d === 1 ? "day" : "days"}
              </option>
            ))}
          </select>
          <button className={styles.secondaryButton}>Show</button>
        </form>
        <Card className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-navy-dark/70">
              <tr>
                <th className="py-2 pr-3">Time (Lagos)</th>
                <th className="py-2 pr-3">Who</th>
                <th className="py-2 pr-3">What</th>
                <th className="py-2 pr-3">Template / category</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2">Cost</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-navy/10 align-top">
                  <td className="py-2 pr-3 whitespace-nowrap">
                    {new Date(r.created_at).toLocaleString("en-GB", { timeZone: "Africa/Lagos" })}
                  </td>
                  <td className="py-2 pr-3">
                    {r.direction === "in" ? "← " : "→ "}
                    {r.recipient}
                    {r.student && ` (${r.student})`}
                  </td>
                  <td className="py-2 pr-3">{r.summary}</td>
                  <td className="py-2 pr-3">
                    {r.template ?? r.kind} {r.category && `· ${r.category}`}
                  </td>
                  <td
                    className={`py-2 pr-3 ${r.status === "failed" || r.status === "blocked" ? "text-red-700" : ""}`}
                  >
                    {r.status}
                    {r.simulated && " (simulated)"}
                    {r.error && <span className="block text-xs">{r.error}</span>}
                  </td>
                  <td className="py-2">
                    {r.estimated_cost_usd !== null ? `$${r.estimated_cost_usd.toFixed(4)}` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <p className={styles.hint}>No messages match.</p>}
        </Card>
      </section>
    </div>
  );
}
