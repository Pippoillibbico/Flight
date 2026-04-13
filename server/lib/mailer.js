import nodemailer from 'nodemailer';

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const secure = String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true';
  if (!host || !user || !pass) return null;

  transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass }
  });
  return transporter;
}

export async function sendMail({ to, subject, text, html }) {
  const from = process.env.SMTP_FROM || 'Flight Suite <no-reply@mg.flight.clariter.cloud>';
  const tx = getTransporter();
  if (!tx) {
    return { sent: false, skipped: true, reason: 'smtp_not_configured' };
  }

  const info = await tx.sendMail({ from, to, subject, text, html });
  return { sent: true, skipped: false, messageId: info.messageId };
}
