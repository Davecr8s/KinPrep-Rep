import type { Access } from "@/lib/rules/access";

/** Plain-English access status for a child, from getStudentAccess. */
export function AccessBadge({
  access,
  onTrial,
  timeZone,
}: {
  access: Access;
  onTrial: boolean;
  timeZone: string;
}) {
  const until =
    access.until?.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone }) ?? "";
  if (access.awaitingConsent) {
    return <Badge tone="warn">Waiting for guardian consent</Badge>;
  }
  if (access.state === "active") {
    return (
      <Badge tone="good">{onTrial ? `Free trial until ${until}` : `Active until ${until}`}</Badge>
    );
  }
  if (access.state === "grace") {
    return <Badge tone="warn">{`Payment due: renew by ${until}`}</Badge>;
  }
  return <Badge tone="off">Not active: choose a plan</Badge>;
}

function Badge({ tone, children }: { tone: "good" | "warn" | "off"; children: string }) {
  const tones = {
    good: "bg-green-100 text-green-900",
    warn: "bg-orange-light text-navy-dark",
    off: "bg-navy/10 text-navy-dark",
  };
  const icons = { good: "✓", warn: "!", off: "–" };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ${tones[tone]}`}
    >
      <span aria-hidden>{icons[tone]}</span>
      {children}
    </span>
  );
}
