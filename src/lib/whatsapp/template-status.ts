// Each message template's approval status and category at Meta, compared with what we asked for
// (src/config/templates.ts). Used by /admin/messages and scripts/meta-templates.ts.
// No imports: the script loads this file directly with Node.

export type MetaTemplate = {
  name: string;
  language: string;
  status: string;
  category: string;
  rejected_reason?: string;
};

export type TemplateStatusRow = {
  name: string;
  language: string;
  ours: string;
  meta: string | null;
  status: string | null;
  /** Meta classed it differently (usually: as marketing). */
  reclassified: boolean;
  notes: string[];
};

export async function fetchMetaTemplates(input: {
  token: string;
  account: string;
  version: string;
  fetch?: typeof fetch;
}): Promise<MetaTemplate[]> {
  const doFetch = input.fetch ?? fetch;
  const found: MetaTemplate[] = [];
  let next: string | undefined =
    `https://graph.facebook.com/${input.version}/${input.account}/message_templates?fields=name,language,status,category,rejected_reason&limit=100`;
  while (next) {
    const response = await doFetch(next, { headers: { Authorization: `Bearer ${input.token}` } });
    const json = (await response.json()) as {
      data?: MetaTemplate[];
      paging?: { next?: string };
      error?: { message: string };
    };
    if (!response.ok) {
      throw new Error(`Meta API error (${response.status}): ${json.error?.message ?? "unknown"}`);
    }
    found.push(...(json.data ?? []));
    next = json.paging?.next;
  }
  return found;
}

export function compareTemplates(
  ours: readonly { name: string; language: string; category: string }[],
  found: readonly MetaTemplate[],
): TemplateStatusRow[] {
  return ours.map((t) => {
    const meta = found.find((m) => m.name === t.name && m.language === t.language);
    const metaCategory = meta ? meta.category.toLowerCase() : null;
    const notes = [
      !meta ? "not submitted: create it in WhatsApp Manager" : "",
      meta && meta.status !== "APPROVED" ? `status ${meta.status}` : "",
      meta?.rejected_reason && meta.rejected_reason !== "NONE"
        ? `rejected: ${meta.rejected_reason}`
        : "",
      meta && metaCategory !== t.category
        ? `Meta classed it as ${metaCategory!.toUpperCase()} (we asked for ${t.category})`
        : "",
    ].filter(Boolean);
    return {
      name: t.name,
      language: t.language,
      ours: t.category,
      meta: metaCategory,
      status: meta?.status ?? null,
      reclassified: Boolean(meta && metaCategory !== t.category),
      notes,
    };
  });
}
