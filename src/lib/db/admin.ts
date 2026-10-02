import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env";

let client: SupabaseClient | undefined;

/** Service-role Supabase client. Bypasses RLS: use only in server code that validates input. */
export function adminDb(): SupabaseClient {
  if (!client) {
    const env = serverEnv("supabase");
    client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}
