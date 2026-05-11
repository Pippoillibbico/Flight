import { Router } from 'express';
import { applyEmailPreferenceUpdate } from '../lib/email/email-preferences.js';
import { verifyUnsubscribeToken } from '../lib/email/unsubscribe-token.js';

function confirmationHtml({ ok, type, message }) {
  const title = ok ? 'Unsubscribed' : 'Unsubscribe link not valid';
  const body = ok
    ? `You have been unsubscribed from ${type} emails.`
    : message || 'This unsubscribe link is invalid or expired.';
  return [
    '<!doctype html><html><head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${title}</title>`,
    '</head><body>',
    `<main style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:640px;margin:48px auto;padding:0 20px;line-height:1.5;">`,
    `<h1>${title}</h1>`,
    `<p>${body}</p>`,
    '</main></body></html>'
  ].join('');
}

export function buildUnsubscribeRouter({ withDb }) {
  const router = Router();

  router.get('/unsubscribe', async (req, res) => {
    const verified = verifyUnsubscribeToken(req.query?.token);
    if (!verified.ok) {
      return res.status(400).type('html').send(
        confirmationHtml({
          ok: false,
          message: verified.error === 'unsubscribe_token_expired' ? 'This unsubscribe link has expired.' : null
        })
      );
    }

    let updated = false;
    await withDb((db) => {
      const user = (db.users || []).find((entry) => String(entry.id || '') === verified.userId) || null;
      if (!user) return db;
      applyEmailPreferenceUpdate(
        user,
        {
          [verified.type]: false
        },
        {
          actor: 'one_click_unsubscribe',
          source: 'email_link'
        }
      );
      updated = true;
      return db;
    });

    if (!updated) {
      return res.status(404).type('html').send(confirmationHtml({ ok: false, message: 'This account was not found.' }));
    }

    return res.type('html').send(confirmationHtml({ ok: true, type: verified.type }));
  });

  return router;
}
