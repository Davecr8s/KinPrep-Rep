// Compares KinPrep's message templates (src/config/templates.ts) with what Meta has: approval
// status, and the category Meta actually gave each one. Meta can move a template we submitted as
// "utility" to "marketing", which costs more and needs marketing opt-in: those are flagged.
// /admin/messages shows the same table.
//
// Usage: node --env-file=.env.local scripts/meta-templates.ts
// Needs WHATSAPP_ACCESS_TOKEN and WHATSAPP_BUSINESS_ACCOUNT_ID (WhatsApp Manager > Account tools).
import { TEMPLATES, type TemplateDefinition } from "../src/config/templates.ts";
import { compareTemplates, fetchMetaTemplates } from "../src/lib/whatsapp/template-status.ts";

const token = process.env.WHATSAPP_ACCESS_TOKEN;
const account = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
const version = process.env.WHATSAPP_GRAPH_VERSION || "v23.0";
if (!token || !account) {
  console.error("Set WHATSAPP_ACCESS_TOKEN and WHATSAPP_BUSINESS_ACCOUNT_ID in .env.local.");
  process.exit(1);
}

let found;
try {
  found = await fetchMetaTemplates({ token, account, version });
} catch (error) {
  console.error(String(error instanceof Error ? error.message : error));
  process.exit(1);
}

const definitions: TemplateDefinition[] = Object.values(TEMPLATES);
const rows = compareTemplates(definitions, found);
const pad = (s: string, n: number) => s.padEnd(n);
console.log(
  `${pad("Template", 32)} ${pad("Lang", 5)} ${pad("Ours", 9)} ${pad("Meta", 15)} ${pad("Status", 10)} Notes`,
);
for (const r of rows) {
  console.log(
    `${pad(r.name, 32)} ${pad(r.language, 5)} ${pad(r.ours, 9)} ${pad(r.meta ?? "-", 15)} ${pad(r.status ?? "-", 10)} ${r.notes.join("; ") || "ok"}`,
  );
}
const marketing = rows.filter((r) => r.meta === "marketing");
console.log("");
console.log(
  marketing.length
    ? `${marketing.length} template(s) classed as MARKETING by Meta: ${marketing.map((r) => r.name).join(", ")}. Reword them as plain account updates and resubmit, or budget for marketing prices and opt-in.`
    : "No template has been classed as marketing.",
);
const missing = definitions.filter((t) => rows.find((r) => r.name === t.name)?.status === null);
if (missing.length) {
  console.log("");
  console.log("To submit (WhatsApp Manager > Message templates > Create), exactly as written:");
  for (const t of missing) {
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
