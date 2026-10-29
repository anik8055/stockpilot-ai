import "server-only";
import { withAdmin } from "@/lib/db";
import { env } from "@/lib/env";
import { logError } from "@/lib/errors";

export type EmailMessage = { to: string; subject: string; text: string; template: string };

/**
 * Sends transactional email through the configured provider.
 * With EMAIL_PROVIDER=none nothing is sent; in development the message is printed to the server console
 * (so password-reset links can be tested locally). Production never logs message bodies.
 */
export async function sendEmail(msg: EmailMessage): Promise<"sent" | "skipped_no_provider" | "failed"> {
  const e = env();
  let status: "sent" | "skipped_no_provider" | "failed" = "skipped_no_provider";
  let error: string | null = null;
  if (e.EMAIL_PROVIDER === "resend" && e.RESEND_API_KEY && e.EMAIL_FROM) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${e.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: e.EMAIL_FROM, to: [msg.to], subject: msg.subject, text: msg.text }),
        signal: AbortSignal.timeout(10_000),
      });
      status = res.ok ? "sent" : "failed";
      if (!res.ok) error = `HTTP ${res.status}`;
    } catch (err) {
      status = "failed";
      error = err instanceof Error ? err.message : "unknown";
      logError("email.send", err, { template: msg.template });
    }
  } else if (e.NODE_ENV !== "production") {
    console.info(`\n[dev email — not sent, no provider configured]\nTo: ${msg.to}\nSubject: ${msg.subject}\n\n${msg.text}\n`);
  }
  await withAdmin((tx) =>
    tx.query("INSERT INTO outbound_emails (to_email, template, status, provider, error) VALUES ($1, $2, $3, $4, $5)", [
      msg.to,
      msg.template,
      status,
      e.EMAIL_PROVIDER,
      error,
    ]),
  );
  return status;
}

export function emailConfigured(): boolean {
  const e = env();
  return e.EMAIL_PROVIDER === "resend" && !!e.RESEND_API_KEY && !!e.EMAIL_FROM;
}
