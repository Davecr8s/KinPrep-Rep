import { NextResponse, type NextRequest } from "next/server";
import { userDb } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/tokens";

// The magic link lands here: verify the token hash, set the session cookie, go on to `next`.
// Works even if the email is opened in a different browser from the one that asked for it.
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const next = safeNextPath(searchParams.get("next"));

  if (tokenHash && (type === "email" || type === "magiclink" || type === "signup")) {
    const db = await userDb();
    const { error } = await db.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(new URL(next, request.url));
  }
  return NextResponse.redirect(new URL("/app/sign-in?error=link", request.url));
}
