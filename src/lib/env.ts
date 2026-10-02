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
  }),
  llm: z.object({
    LLM_API_KEY: secret,
    LLM_MODEL: secret,
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
