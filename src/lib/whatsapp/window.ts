// WhatsApp's customer-service window: free-form messages are allowed only within 24 hours of the
// contact's last message; outside it, only approved templates (CLAUDE.md).

export const FREEFORM_WINDOW_MS = 24 * 60 * 60 * 1000;

export function canSendFreeform(
  contact: { lastInboundAt: Date | null },
  now: Date = new Date(),
): boolean {
  if (!contact.lastInboundAt) return false;
  const age = now.getTime() - contact.lastInboundAt.getTime();
  return age >= 0 && age < FREEFORM_WINDOW_MS;
}
