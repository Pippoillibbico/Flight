import { sendEmail } from './email/email-provider.js';

export async function sendMail({ to, subject, text, html, type = 'service', plan = 'unknown' }) {
  return sendEmail({ to, subject, text, html, type, plan });
}
