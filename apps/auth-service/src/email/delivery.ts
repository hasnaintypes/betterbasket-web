import type { EmailMessage, EmailSender } from "./sender";
import { EmailDeliveryError } from "./sender";

export interface EmailDeliveryConfig {
  apiUrl: string;
  webUrl: string;
  nodeEnv: string;
  allowedRecipients: string[];
}

export function createEmailDelivery(sender: EmailSender, config: EmailDeliveryConfig) {
  const allowed = new Set(config.allowedRecipients.map((email) => email.toLowerCase()));

  function enqueue(kind: EmailMessage["kind"], to: string, token: string, authLink: string): void {
    if (config.nodeEnv !== "production" && !allowed.has(to.toLowerCase())) return;
    const link = new URL(authLink);
    if (link.origin !== new URL(config.apiUrl).origin) return;
    const callback = kind === "verification" ? "/email-verified" : "/reset-password";
    link.searchParams.set("callbackURL", new URL(callback, config.webUrl).toString());
    const message: EmailMessage = { kind, to, token, link: link.toString() };
    void deliver(message, 0);
  }

  async function deliver(message: EmailMessage, attempt: number): Promise<void> {
    try {
      await sender.send(message);
    } catch (error) {
      if (error instanceof EmailDeliveryError && error.status === 429 && attempt < 2) {
        const delay = Math.min(error.retryAfterSeconds * 1000, 30_000);
        const timer = setTimeout(() => void deliver(message, attempt + 1), delay);
        timer.unref();
        return;
      }
      // Never log addresses, links, tokens, or provider response bodies.
      process.stderr.write(`Auth ${message.kind} email delivery failed.\n`);
    }
  }

  return { enqueue };
}
