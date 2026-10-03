import type { Instrumentation } from "next";

// Every uncaught server error (pages, route handlers, server actions, the proxy) is reported to
// the logs and, when SENTRY_DSN is set, to Sentry. See src/lib/monitoring.

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { reportError } = await import("@/lib/monitoring/report");
  await reportError({
    where: `${context.routeType}:${context.routePath}`,
    error,
    method: request.method,
    path: request.path,
    tags: { router: context.routerKind },
  });
};
