import { createHash } from "node:crypto";

export type EmailKind = "verification" | "password-reset";
export interface EmailMessage {
  kind: EmailKind;
  to: string;
  link: string;
  token: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

export class ConsoleEmailSender implements EmailSender {
  async send(message: EmailMessage): Promise<void> {
    // Deliberately omit the recipient, token, and link from logs.
    process.stdout.write(`Auth ${message.kind} email suppressed in local development.\n`);
  }
}

export class ResendEmailSender implements EmailSender {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(message: EmailMessage): Promise<void> {
    const action = message.kind === "verification" ? "Verify your email" : "Reset your password";
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": createHash("sha256")
          .update(`${message.kind}:${message.token}`)
          .digest("hex"),
      },
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject: action,
        text: `${action}: ${message.link}`,
        html: `<p>${action}: <a href="${escapeHtml(message.link)}">Continue</a></p>`,
      }),
    });
    if (response.ok) return;
    const retryAfter = response.headers.get("retry-after");
    const retrySeconds = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : 1;
    throw new EmailDeliveryError(response.status, Math.min(retrySeconds, 30));
  }
}

export class EmailDeliveryError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfterSeconds: number,
  ) {
    super(`Email provider returned ${status}`);
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const replacements: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return replacements[character] ?? character;
  });
}
