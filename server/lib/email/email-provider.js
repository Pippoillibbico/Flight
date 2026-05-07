import nodemailer from 'nodemailer';
import { getEmailReadiness } from './email-readiness.js';
import { recordEmailDeliveryFailed } from './email-metrics.js';
import { logger as defaultLogger } from '../logger.js';

let cachedTransporter = null;
let cachedKey = null;

function smtpKey(env) {
  return [env.SMTP_HOST, env.SMTP_PORT || '587', env.SMTP_USER, env.SMTP_SECURE || 'false'].join('|');
}

function safeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!email.includes('@')) return 'masked_email';
  const [local, domain] = email.split('@');
  return `${local.slice(0, 2)}***@${domain}`;
}

function getSmtpTransporter(env = process.env, transportFactory = nodemailer.createTransport) {
  const key = smtpKey(env);
  if (cachedTransporter && cachedKey === key) return cachedTransporter;
  cachedKey = key;
  cachedTransporter = transportFactory({
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT || 587),
    secure: String(env.SMTP_SECURE || 'false').trim().toLowerCase() === 'true',
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASS
    }
  });
  return cachedTransporter;
}

export function createEmailProvider({ env = process.env, logger = defaultLogger, transportFactory = nodemailer.createTransport } = {}) {
  async function sendEmail({ to, subject, text, html, type = 'service', plan = 'unknown' }) {
    const readiness = getEmailReadiness(env);
    const from = String(env.SMTP_FROM || 'Flight Suite <no-reply@flightsuite.app>').trim();
    const safeMeta = {
      provider: readiness.provider,
      status: readiness.status,
      dryRun: readiness.dryRun,
      to: safeEmail(to),
      type,
      plan
    };

    if (readiness.status === 'EMAIL_DRY_RUN') {
      logger.info(safeMeta, 'email_dry_run_skipped');
      return { sent: false, skipped: true, dryRun: true, reason: 'email_dry_run' };
    }
    if (readiness.status !== 'EMAIL_READY') {
      logger.warn(safeMeta, 'email_not_configured_skipped');
      return { sent: false, skipped: true, reason: 'email_not_configured' };
    }

    try {
      const transporter = getSmtpTransporter(env, transportFactory);
      const info = await transporter.sendMail({ from, to, subject, text, html });
      logger.info({ ...safeMeta, messageId: info?.messageId || null }, 'email_sent');
      return { sent: true, skipped: false, messageId: info?.messageId || null };
    } catch (error) {
      recordEmailDeliveryFailed();
      logger.warn({ ...safeMeta, err_code: String(error?.code || '').slice(0, 60) }, 'email_delivery_failed');
      return { sent: false, skipped: false, reason: error?.message || 'email_delivery_failed' };
    }
  }

  return { sendEmail, readiness: () => getEmailReadiness(env) };
}

export const defaultEmailProvider = createEmailProvider();

export async function sendEmail(payload) {
  return defaultEmailProvider.sendEmail(payload);
}
