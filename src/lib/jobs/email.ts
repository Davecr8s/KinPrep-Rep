import { randomUUID } from "node:crypto";

// Email for payers who haven't opted in to WhatsApp. Sent through Resend's HTTP API (one request,
// no SDK); RESEND_API_KEY and EMAIL_FROM in the environment.

export type EmailMessage = { to: string; subject: string; text: string };

export interface EmailTransport {
  readonly simulated: boolean;
  /** Sends and returns the provider's message id. */
  send(message: EmailMessage): Promise<string>;
}

export function resendTransport(config: {
  apiKey: string;
  from: string;
  fetch?: typeof fetch;
}): EmailTransport {
  const doFetch = config.fetch ?? fetch;
  return {
    simulated: false,
    async send(message) {
      const response = await doFetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: config.from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
        }),
      });
      const json = (await response.json().catch(() => null)) as {
        id?: string;
        message?: string;
      } | null;
      if (!response.ok || !json?.id) {
        throw new Error(`Email send failed (${response.status}): ${json?.message ?? "no id"}`);
      }
      return json.id;
    },
  };
}

/** For tests and local runs: nothing leaves the server. */
export function simulatedEmailTransport(): EmailTransport {
  return { simulated: true, send: async () => `sim-email.${randomUUID()}` };
}
