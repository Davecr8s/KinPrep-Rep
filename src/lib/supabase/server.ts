import "server-only";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { serverEnv } from "@/lib/env";

/** Supabase client acting as the signed-in user (from the session cookie). RLS applies. */
export async function userDb(): Promise<SupabaseClient> {
  // Read cookies first: it marks the route as per-request, so the build never pre-renders it.
  const cookieStore = await cookies();
  const env = serverEnv("supabaseAuth");
  return createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component, where cookies are read-only. proxy.ts refreshes the
            // session on every /app request, so nothing is lost.
          }
        },
      },
    },
  );
}
