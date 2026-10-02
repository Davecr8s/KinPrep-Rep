import { practiceGet, practicePost } from "@/lib/practice/web";
import { webDeps } from "@/lib/practice/server";

// The web practice page (/p/<token>). A route handler rather than a React page so each load is a
// few KB of plain HTML, for cheap Android phones on slow data. See src/lib/practice/web.ts.

export async function GET(request: Request, ctx: RouteContext<"/p/[token]">) {
  const { token } = await ctx.params;
  return practiceGet(token, new URL(request.url), webDeps());
}

export async function POST(request: Request, ctx: RouteContext<"/p/[token]">) {
  const { token } = await ctx.params;
  const body = await request.text();
  if (body.length > 2_000) return new Response("Too large", { status: 413 });
  return practicePost(token, new URLSearchParams(body), webDeps());
}
