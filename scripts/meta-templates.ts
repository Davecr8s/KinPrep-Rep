// Compares KinPrep's message templates (src/config/templates.ts) with what Meta has: approval
// status, and the category Meta actually gave each one. Meta can move a template we submitted as
// "utility" to "marketing", which costs more and needs marketing opt-in: those are flagged.
//
// Usage: node --env-file=.env.local scripts/meta-templates.ts
// Needs WHATSAPP_ACCESS_TOKEN and WHATSAPP_BUSINESS_ACCOUNT_ID (WhatsApp Manager > Account tools).
import { TEMPLATES, type TemplateDefinition } from "../src/config/templates.ts";

const token = process.env.WHATSAPP_ACCESS_TOKEN;
const account = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
const version = process.env.WHATSAPP_GRAPH_VERSION || "v23.0";
if (!token || !account) {
  console.error("Set WHATSAPP_ACCESS_TOKEN and WHATSAPP_BUSINESS_ACCOUNT_ID in .env.local.");
  process.exit(1);
}

type MetaTemplate = {
  name: string;
  language: string;
  status: string;
  category: string;
  rejected_reason?: string;
};

const found: MetaTemplate[] = [];
let next: string | undefined =
  `https://graph.facebook.com/${version}/${account}/message_templates?fields=name,language,status,category,rejected_reason&limit=100`;
while (next) {
  const response = await fetch(next, { headers: { Authorization: `Bearer ${token}` } });
  const json = (await response.json()) as {
    data?: MetaTemplate[];
    paging?: { next?: string };
    error?: { message: string };
  };
  if (!response.ok) {
    console.error(`Meta API error (${response.status}): ${json.error?.message ?? "unknown"}`);
    process.exit(1);
  }
  found.push(...(json.data ?? []));
  next = json.paging?.next;
}

const rows = Object.values(TEMPLATES).map((t: TemplateDefinition) => {
  const meta = found.find((m) => m.name === t.name && m.language === t.language);
  const metaCategory = meta?.category.toLowerCase() ?? "-";
  const flags = [
    !meta ? "NOT SUBMITTED: create it in WhatsApp Manager" : "",
    meta && meta.status !== "APPROVED" ? `status ${meta.status}` : "",
    meta?.rejected_reason && meta.rejected_reason !== "NONE"
      ? `rejected: ${meta.rejected_reason}`
      : "",
    meta && metaCategory !== t.category
      ? `Meta classed it as ${metaCategory.toUpperCase()} (we asked for ${t.category})`
      : "",
  ].filter(Boolean);
  return { t, meta, metaCategory, flags };
});

const pad = (s: string, n: number) => s.padEnd(n);
console.log(
  `${pad("Template", 32)} ${pad("Lang", 5)} ${pad("Ours", 9)} ${pad("Meta", 15)} ${pad("Status", 10)} Notes`,
);
for (const { t, meta, metaCategory, flags } of rows) {
  console.log(
    `${pad(t.name, 32)} ${pad(t.language, 5)} ${pad(t.category, 9)} ${pad(metaCategory, 15)} ${pad(meta?.status ?? "-", 10)} ${flags.join("; ") || "ok"}`,
  );
}
const marketing = rows.filter((r) => r.meta && r.metaCategory === "marketing");
console.log("");
console.log(
  marketing.length
    ? `${marketing.length} template(s) classed as MARKETING by Meta: ${marketing.map((r) => r.t.name).join(", ")}. Reword them as plain account updates and resubmit, or budget for marketing prices and opt-in.`
    : "No template has been classed as marketing.",
);
const missing = rows.filter((r) => !r.meta);
if (missing.length) {
  console.log("");
  console.log("To submit (WhatsApp Manager > Message templates > Create), exactly as written:");
  for (const { t } of missing) {
    console.log(`\n${t.name} (${t.language}, ${t.category}): ${t.purpose}`);
    console.log(`  Body: ${t.body}`);
    console.log(`  Variables: ${t.variables.map((v, i) => `{{${i + 1}}} = ${v}`).join(", ")}`);
    for (const b of t.buttons ?? []) {
      console.log(
        b.type === "url"
          ? `  Button (link): "${b.text}" -> ${b.url} ({{1}} = ${b.variable}; {APP_URL} = your site)`
          : `  Button (quick reply): "${b.text}"`,
      );
    }
  }
}
