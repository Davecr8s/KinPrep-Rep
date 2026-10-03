import "server-only";
import { z } from "zod";

// Server environment, validated with Zod. Variables are grouped by integration and each
// group is checked the first time it is used, so a missing WhatsApp key cannot break the
// payer app before Phase 8. Every variable here must also be listed in .env.example.

const secret = z.string().min(1);

export const envGroups = {
  app: z.object({
    NEXT_PUBLIC_APP_URL: z.url(),
  }),
  cron: z.object({
    CRON_SECRET: z.string().min(32),
  }),
  supabase: z.object({
    NEXT_PUBLIC_SUPABASE_URL: z.url(),
    SUPABASE_SECRET_KEY: secret,
  }),
  // Signed-in user's client: RLS applies. The publishable key is public, not a secret.
  supabaseAuth: z.object({
    NEXT_PUBLIC_SUPABASE_URL: z.url(),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: secret,
  }),
  stripe: z.object({
    STRIPE_SECRET_KEY: z.string().startsWith("sk_"),
    STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_"),
  }),
  paystack: z.object({
    PAYSTACK_SECRET_KEY: z.string().startsWith("sk_"),
    // Plan codes for recurring card subscriptions; create them with scripts/paystack-plans.ts.
    PAYSTACK_PLAN_NIGERIA_WEEKLY: z.string().startsWith("PLN_").optional(),
    PAYSTACK_PLAN_NIGERIA_MONTHLY: z.string().startsWith("PLN_").optional(),
  }),
  whatsapp: z.object({
    WHATSAPP_ACCESS_TOKEN: secret,
    WHATSAPP_PHONE_NUMBER_ID: secret,
    WHATSAPP_APP_SECRET: secret,
    WHATSAPP_VERIFY_TOKEN: z.string().min(16),
    WHATSAPP_GRAPH_VERSION: z
      .string()
      .regex(/^v\d+\.\d+$/)
      .default("v23.0"),
    // WhatsApp Business Account id: only for scripts/meta-templates.ts (template status).
    WHATSAPP_BUSINESS_ACCOUNT_ID: z.string().min(1).optional(),
  }),
  // Email for payers not on WhatsApp (weekly report, junior links, alerts), via Resend.
  email: z.object({
    RESEND_API_KEY: z.string().startsWith("re_"),
    // e.g. "KinPrep <reports@kinprep.ng>"; the domain must be verified in Resend.
    EMAIL_FROM: z.string().min(3),
  }),
  // Signs the web practice links (/p/<token>). Changing it invalidates every link issued.
  practice: z.object({
    PRACTICE_LINK_SECRET: z.string().min(32),
  }),
  // Direct Postgres for the WhatsApp bot and the web practice page (transaction pooler, port 6543).
  database: z.object({
    SUPABASE_DB_URL: z.string().startsWith("postgres"),
    // Connections per server instance. The end-to-end tests use 1 (their PGlite server can't
    // interleave connections).
    SUPABASE_DB_POOL_MAX: z.preprocess(
      (v) => (v === "" ? undefined : v),
      z.coerce.number().int().min(1).max(10).default(3),
    ),
  }),
  llm: z.object({
    LLM_API_KEY: secret,
    LLM_MODEL: secret,
  }),
  // Error monitoring (src/lib/monitoring): Sentry > Project settings > Client keys (DSN). Read
  // straight from process.env so reporting works even when other config is broken; listed here
  // so /api/health can say whether it's set.
  monitoring: z.object({
    SENTRY_DSN: z.url(),
    SENTRY_ENVIRONMENT: z.string().min(1).optional(),
  }),
  // HMAC key for rate-limit counters (src/lib/security). Falls back to CRON_SECRET if unset.
  rateLimit: z.object({
    RATE_LIMIT_SECRET: z.string().min(32),
  }),
} as const;

export type EnvGroup = keyof typeof envGroups;
export type Env<G extends EnvGroup> = z.infer<(typeof envGroups)[G]>;

export function parseEnvGroup<G extends EnvGroup>(
  group: G,
  source: Record<string, string | undefined>,
): Env<G> {
  const result = envGroups[group].safeParse(source);
  if (!result.success) {
    // List variable names only; never echo values, which may be secrets.
    const problems = result.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Invalid or missing ${group} environment variables: ${problems}`);
  }
  return result.data as Env<G>;
}

const cache: Partial<{ [G in EnvGroup]: Env<G> }> = {};

export function serverEnv<G extends EnvGroup>(group: G): Env<G> {
  const cached = cache[group] as Env<G> | undefined;
  if (cached) return cached;
  const parsed = parseEnvGroup(group, process.env);
  (cache as Record<EnvGroup, unknown>)[group] = parsed;
  return parsed;
}
