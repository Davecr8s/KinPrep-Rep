import { NextResponse, type NextRequest } from "next/server";
import { limitRequest } from "@/lib/security/server";
import { userDb } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/tokens";

// The magic link lands here: verify the token hash (or exchange the code), set the session
// cookie, go on to `next`. The token-hash link (our email template, docs/BUILD_PLAN.md) works
// even if the email is opened in a different browser from the one that asked for it.
export async function GET(request: NextRequest) {
  const limited = await limitRequest(request, "authConfirm");
  if (limited) return limited;
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const next = safeNextPath(searchParams.get("next"));

  if (tokenHash && (type === "email" || type === "magiclink" || type === "signup")) {
    const db = await userDb();
    const { error } = await db.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(new URL(next, request.url));
  }
  // Supabase's default email template sends ?code=... instead (PKCE). That only works in the
  // browser that asked for the link, which holds the code verifier cookie.
  const code = searchParams.get("code");
  if (code) {
    const db = await userDb();
    const { error } = await db.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, request.url));
  }
  return NextResponse.redirect(new URL("/app/sign-in?error=link", request.url));
}
