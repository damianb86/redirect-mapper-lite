import nodemailer from "nodemailer";
import { logger } from "./logger.server";

const RECIPIENT = process.env.CONTACT_EMAIL ?? "qorve.dev@gmail.com";
const FROM_NAME = "Redirect Pulse: Bulk Redirects";

function createTransport() {
  // Configure via env vars:
  //   EMAIL_HOST, EMAIL_PORT, EMAIL_USER, EMAIL_PASS
  // Falls back to an Ethereal test account when nothing is set (dev mode).
  if (process.env.EMAIL_HOST) {
    return nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: Number(process.env.EMAIL_PORT ?? 587),
      secure: Number(process.env.EMAIL_PORT ?? 587) === 465,
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
    <p><strong>Type:</strong> ${type}</p>
    <p><strong>Shop:</strong> ${shop}</p>
    ${replyEmail ? `<p><strong>Reply to:</strong> ${replyEmail}</p>` : ""}
    <hr />
    <p>${message.replace(/\n/g, "<br>")}</p>
  `;

  const info = await transport.sendMail({
    from: `"${FROM_NAME}" <${process.env.EMAIL_USER ?? "noreply@redirectmapper.app"}>`,
    to: RECIPIENT,
    replyTo: replyEmail ?? undefined,
    subject: `[Redirect Pulse] ${subject}`,
    html,
  });

  // In dev (jsonTransport) print what would have been sent.
  if (!process.env.EMAIL_HOST) {
    logger.info("email.not_sent", { reason: "missing_email_host", info });
  }

  return info;
}
