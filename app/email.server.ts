import nodemailer from "nodemailer";
import { logger } from "./logger.server";

const RECIPIENT = process.env.CONTACT_EMAIL ?? "contact@zuam.dev";
const FROM_EMAIL = process.env.EMAIL_FROM ?? "noreply@zuam.dev";
const FROM_NAME = process.env.EMAIL_FROM_NAME ?? "Zuam RedirectPulse";
const DEFAULT_REPLY_TO = process.env.EMAIL_REPLY_TO ?? RECIPIENT;

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function createTransport() {
  // Configure via env vars:
  //   EMAIL_HOST, EMAIL_PORT, EMAIL_USER, EMAIL_PASS
  // Resend SMTP should use smtp.resend.com, port 587, user "resend",
  // and EMAIL_PASS with the Resend API key.
  // Falls back to JSON transport when nothing is set (dev mode).
  if (process.env.EMAIL_HOST) {
    const port = Number(process.env.EMAIL_PORT ?? 587);
    const configuredSecure = process.env.EMAIL_SECURE;

    return nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port,
      secure:
        configuredSecure === undefined
          ? port === 465
          : configuredSecure.toLowerCase() === "true",
      auth: {
        user: process.env.EMAIL_USER ?? "",
        pass: process.env.EMAIL_PASS ?? "",
      },
    });
  }

  // Dev fallback — logs the message to console instead of sending.
  return nodemailer.createTransport({ jsonTransport: true });
}

export async function sendContactEmail({
  type,
  subject,
  message,
  replyEmail,
  shop,
}: {
  type: string;
  subject: string;
  message: string;
  replyEmail?: string;
  shop: string;
}) {
  const transport = createTransport();

  const html = `
    <p><strong>Type:</strong> ${escapeHtml(type)}</p>
    <p><strong>Shop:</strong> ${escapeHtml(shop)}</p>
    ${replyEmail ? `<p><strong>Reply to:</strong> ${escapeHtml(replyEmail)}</p>` : ""}
    <hr />
    <p>${escapeHtml(message).replace(/\n/g, "<br>")}</p>
  `;

  const info = await transport.sendMail({
    from: { name: FROM_NAME, address: FROM_EMAIL },
    to: RECIPIENT,
    replyTo: isValidEmail(replyEmail) ? replyEmail : DEFAULT_REPLY_TO,
    subject: `[Redirect Pulse] ${subject}`,
    html,
  });

  // In dev (jsonTransport) print what would have been sent.
  if (!process.env.EMAIL_HOST) {
    logger.info("email.not_sent", { reason: "missing_email_host", info });
  }

  return info;
}

function isValidEmail(value?: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ""));
}
