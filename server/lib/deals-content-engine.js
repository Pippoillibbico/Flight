import { nanoid } from 'nanoid';
import { createDiscoveryFeedService } from './discovery-feed-service.js';
import { withDb as defaultWithDb } from './db.js';
import { parseFlag } from './env-flags.js';
import { sendMail } from './mailer.js';
import { insertEmailDeliveryLog } from './sql-db.js';
import { logger as rootLogger } from './logger.js';

const PUSH_TIMEOUT_MS = Math.max(2000, Number(process.env.PUSH_TIMEOUT_MS || 8000));
const PUSH_RETRIES = Math.max(0, Math.min(4, Number(process.env.PUSH_RETRIES || 2)));
const PUSH_RETRY_BASE_MS = Math.max(100, Number(process.env.PUSH_RETRY_BASE_MS || 250));
const SOCIAL_TIMEOUT_MS = Math.max(2000, Number(process.env.DEALS_CONTENT_SOCIAL_TIMEOUT_MS || 8000));
const SOCIAL_RETRIES = Math.max(0, Math.min(4, Number(process.env.DEALS_CONTENT_SOCIAL_RETRIES || 1)));
const SOCIAL_RETRY_BASE_MS = Math.max(100, Number(process.env.DEALS_CONTENT_SOCIAL_RETRY_BASE_MS || 250));

function toNumber(value, fallback = 0) {
  const out = Number(value);
  return Number.isFinite(out) ? out : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function parseList(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))];
  }
  return [...new Set(String(value || '').split(/[,\n;]+/).map((item) => item.trim()).filter(Boolean))];
}

function normalizeTimezone(value) {
  const timezone = String(value || '').trim() || 'UTC';
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date());
    return timezone;
  } catch {
    return 'UTC';
  }
}

function dateKey(value, timezone) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

function parseDateOnly(value) {
  const text = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const parsed = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isWeekendDeal(item) {
  const depart = parseDateOnly(item?.depart_date);
  if (!depart) return false;
  const departDay = depart.getUTCDay();
  const isWeekendDepart = departDay === 5 || departDay === 6;
  if (!isWeekendDepart) return false;

  if (!item.return_date) return true;
  const ret = parseDateOnly(item.return_date);
  if (!ret) return false;
  const returnDay = ret.getUTCDay();
  const isWeekendReturn = returnDay === 0 || returnDay === 1;
  const tripDays = Math.round((ret.getTime() - depart.getTime()) / (24 * 60 * 60 * 1000));
  return isWeekendReturn && tripDays >= 1 && tripDays <= 4;
}

function isCrazyDeal(item) {
  const type = String(item?.deal_type || '').trim().toLowerCase();
  const finalScore = toNumber(item?.final_score, 0);
  const savingsPct = toNumber(item?.savings_pct, 0);
  return type === 'rare_opportunity' || finalScore >= 85 || savingsPct >= 45;
}

function dedupeDeals(items, limit = Infinity) {
  const out = [];
  const seen = new Set();
  for (const item of items || []) {
    const key = String(item?.deal_key || item?.id || '').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

function sortByCheap(a, b) {
  return (
    toNumber(a?.price, 0) - toNumber(b?.price, 0) ||
    toNumber(b?.savings_pct, 0) - toNumber(a?.savings_pct, 0) ||
    toNumber(b?.final_score, 0) - toNumber(a?.final_score, 0)
  );
}

function sortByCrazy(a, b) {
  return (
    toNumber(b?.final_score, 0) - toNumber(a?.final_score, 0) ||
    toNumber(b?.savings_pct, 0) - toNumber(a?.savings_pct, 0) ||
    toNumber(a?.price, 0) - toNumber(b?.price, 0)
  );
}

function collectFeedItems(feed) {
  const pools = [
    feed?.queries?.top_offers,
    feed?.queries?.recent_offers,
    feed?.queries?.popular_offers,
    feed?.categories?.cheap_flights,
    feed?.categories?.weekend_flights,
    feed?.categories?.last_minute_flights,
    feed?.categories?.long_haul_discounted
  ];
  const flat = [];
  for (const list of pools) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (item && typeof item === 'object') flat.push(item);
    }
  }
  return dedupeDeals(flat, 5000);
}

function routeLabel(item) {
  const origin = String(item?.origin_iata || '').trim() || 'N/A';
  const destination = String(item?.destination_iata || '').trim() || 'N/A';
  return `${origin} -> ${destination}`;
}

function formatDealLine(item) {
  const route = routeLabel(item);
  const price = Math.round(toNumber(item?.price, 0));
  const savings = Math.round(toNumber(item?.savings_pct, 0));
  const depart = String(item?.depart_date || '').slice(0, 10) || 'n/a';
  return `${route} da EUR ${price} (${savings}% sotto baseline, partenza ${depart})`;
}

function formatDestinationLine(item) {
  const code = String(item?.destination_iata || '').trim() || 'N/A';
  const city = String(item?.destination_city || '').trim();
  const price = Math.round(toNumber(item?.from_price, 0));
  const route = routeLabel(item);
  const destination = city ? `${city} (${code})` : code;
  return `${destination} da EUR ${price} (${route})`;
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderTextList(items, formatter) {
  if (!Array.isArray(items) || items.length === 0) return 'Nessun deal trovato oggi.';
  return items.map((item, index) => `${index + 1}. ${formatter(item)}`).join('\n');
}

function renderHtmlList(items, formatter) {
  if (!Array.isArray(items) || items.length === 0) return '<p>Nessun deal trovato oggi.</p>';
  const rows = items.map((item) => `<li>${escapeHtml(formatter(item))}</li>`).join('');
  return `<ul>${rows}</ul>`;
}

function buildPushOutput({ sections, generatedAt, timezone }) {
  const highlight =
    sections.top5CheapFlightsToday[0] || sections.crazyFlightsToday[0] || sections.weekendLowCost[0] || sections.destinationsUnder300[0] || null;
  const highlightText = highlight ? `${routeLabel(highlight)} da EUR ${Math.round(toNumber(highlight.price || highlight.from_price, 0))}` : 'nessuna novita';
  const message = [
    `Top 5 low cost aggiornati (${highlightText}).`,
    `${sections.destinationsUnder300.length} destinazioni sotto EUR 300.`,
    `${sections.weekendLowCost.length} weekend low cost.`,
    `${sections.crazyFlightsToday.length} voli folli oggi.`
  ].join(' ');
  return {
    title: 'Flight digest: offerte di oggi',
    message: message.slice(0, 280),
    metadata: {
      generatedAt,
      timezone,
      sectionCounts: {
        top5CheapFlightsToday: sections.top5CheapFlightsToday.length,
        destinationsUnder300: sections.destinationsUnder300.length,
        weekendLowCost: sections.weekendLowCost.length,
        crazyFlightsToday: sections.crazyFlightsToday.length
      }
    }
  };
}

function buildNewsletterOutput({ sections, generatedAt, timezone }) {
  const subject = 'Flight digest: voli low cost di oggi';
  const generatedLine = `Generato: ${generatedAt} (${timezone})`;
  const top5Text = renderTextList(sections.top5CheapFlightsToday, formatDealLine);
  const destinationsText = renderTextList(sections.destinationsUnder300, formatDestinationLine);
  const weekendText = renderTextList(sections.weekendLowCost, formatDealLine);
  const crazyText = renderTextList(sections.crazyFlightsToday, formatDealLine);

  const text = [
    generatedLine,
    '',
    'Top 5 voli economici oggi',
    top5Text,
    '',
    'Destinazioni sotto 300EUR',
    destinationsText,
    '',
    'Weekend low cost',
    weekendText,
    '',
    'Voli folli trovati oggi',
    crazyText
  ].join('\n');

  const html = [
    `<p>${escapeHtml(generatedLine)}</p>`,
    '<h3>Top 5 voli economici oggi</h3>',
    renderHtmlList(sections.top5CheapFlightsToday, formatDealLine),
    '<h3>Destinazioni sotto 300EUR</h3>',
    renderHtmlList(sections.destinationsUnder300, formatDestinationLine),
    '<h3>Weekend low cost</h3>',
    renderHtmlList(sections.weekendLowCost, formatDealLine),
    '<h3>Voli folli trovati oggi</h3>',
    renderHtmlList(sections.crazyFlightsToday, formatDealLine)
  ].join('');

  return { subject, text, html };
}

function truncate(value, max) {
  const text = String(value || '').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 3)).trim()}...`;
}

function buildSocialOutput({ sections }) {
  const topShort = sections.top5CheapFlightsToday
    .slice(0, 3)
    .map((item) => `${routeLabel(item)} EUR ${Math.round(toNumber(item?.price, 0))}`)
    .join(' | ');
  const crazyShort = sections.crazyFlightsToday
    .slice(0, 2)
    .map((item) => `${routeLabel(item)} EUR ${Math.round(toNumber(item?.price, 0))}`)
    .join(' | ');

  const x = truncate(
    `Top 5 voli economici oggi: ${topShort || 'nessun nuovo deal'}.\n${sections.destinationsUnder300.length} destinazioni sotto EUR 300, ${sections.weekendLowCost.length} weekend low cost, ${sections.crazyFlightsToday.length} voli folli.\n#voli #lowcost #travel`,
    280
  );

  const instagram = [
    'Top 5 voli economici oggi:',
    sections.top5CheapFlightsToday.length > 0
      ? sections.top5CheapFlightsToday.slice(0, 5).map((item) => `- ${formatDealLine(item)}`).join('\n')
      : '- Nessun nuovo deal oggi.',
    '',
    `Destinazioni sotto EUR 300: ${sections.destinationsUnder300.length}`,
    `Weekend low cost: ${sections.weekendLowCost.length}`,
    `Voli folli trovati oggi: ${sections.crazyFlightsToday.length}`,
    '#voli #lowcost #traveldeal'
  ].join('\n');

  const linkedin = [
    'Daily flight content digest',
    `Top 5 voli economici oggi: ${sections.top5CheapFlightsToday.length}`,
    `Destinazioni sotto 300EUR: ${sections.destinationsUnder300.length}`,
    `Weekend low cost: ${sections.weekendLowCost.length}`,
    `Voli folli trovati oggi: ${sections.crazyFlightsToday.length}`,
    `Highlight: ${topShort || crazyShort || 'nessun nuovo deal'}`
  ].join('\n');

  return { x, instagram, linkedin };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postJsonWithRetry({ fetchFn, url, payload, token, timeoutMs, retries, retryBaseMs }) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchFn(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      if (response.ok) return { sent: true, status: response.status, reason: null };
      const retryable = response.status === 429 || (response.status >= 500 && response.status <= 599);
      if (!retryable || attempt === retries) return { sent: false, status: response.status, reason: `http_${response.status}` };
    } catch (error) {
      if (attempt === retries) {
        return { sent: false, status: null, reason: error?.name === 'AbortError' ? 'timeout' : 'network_error' };
      }
    } finally {
      clearTimeout(timer);
    }
    await sleep(retryBaseMs * 2 ** attempt);
  }
  return { sent: false, status: null, reason: 'unknown_error' };
}

export function createDealsContentEngine(options = {}) {
  const feedService = options.feedService || createDiscoveryFeedService(options.feedServiceOptions || {});
  const logger = options.logger || rootLogger;
  const fetchFn = options.fetchFn || fetch;
  const mailer = options.sendMail || sendMail;
  const emailLogWriter = options.insertEmailDeliveryLog || insertEmailDeliveryLog;
  const withDb = options.withDb || defaultWithDb;
  const timezone = normalizeTimezone(options.timezone || process.env.DEALS_CONTENT_TIMEZONE || process.env.FREE_JOBS_TIMEZONE || 'UTC');

  const feedLimit = clamp(Number(options.feedLimit || process.env.DEALS_CONTENT_FEED_LIMIT || 80), 20, 200);
  const topCheapLimit = clamp(Number(options.topCheapLimit || process.env.DEALS_CONTENT_TOP_CHEAP_LIMIT || 5), 1, 20);
  const destinationsLimit = clamp(Number(options.destinationsLimit || process.env.DEALS_CONTENT_DESTINATIONS_LIMIT || 12), 1, 30);
  const weekendLimit = clamp(Number(options.weekendLimit || process.env.DEALS_CONTENT_WEEKEND_LIMIT || 8), 1, 20);
  const crazyLimit = clamp(Number(options.crazyLimit || process.env.DEALS_CONTENT_CRAZY_LIMIT || 6), 1, 20);

  const pushWebhookUrl = String(options.pushWebhookUrl || process.env.PUSH_WEBHOOK_URL || '').trim();
  const pushWebhookToken = String(options.pushWebhookToken || process.env.PUSH_WEBHOOK_TOKEN || '').trim();
  const pushUserIds = parseList(options.pushUserIds ?? process.env.DEALS_CONTENT_PUSH_USER_IDS ?? 'broadcast');
  const newsletterRecipients = parseList(options.newsletterRecipients ?? process.env.DEALS_CONTENT_NEWSLETTER_RECIPIENTS);
  const socialWebhookUrl = String(options.socialWebhookUrl || process.env.DEALS_CONTENT_SOCIAL_WEBHOOK_URL || '').trim();
  const socialWebhookToken = String(options.socialWebhookToken || process.env.DEALS_CONTENT_SOCIAL_WEBHOOK_TOKEN || '').trim();
  const inAppEnabled = parseFlag(options.inAppEnabled ?? process.env.DEALS_CONTENT_INAPP_ENABLED, true);
  const inAppMaxUsers = clamp(Number(options.inAppMaxUsers || process.env.DEALS_CONTENT_INAPP_MAX_USERS || 5000), 1, 50000);

  async function generateContent({ origin = '', maxPrice = null, now = new Date() } = {}) {
    const feed = await feedService.buildDiscoveryFeed({
      origin,
      maxPrice,
      limit: feedLimit
    });

    const generatedAt = new Date(now).toISOString();
    if (feed?.skipped) {
      const emptySections = {
        top5CheapFlightsToday: [],
        destinationsUnder300: [],
        weekendLowCost: [],
        crazyFlightsToday: []
      };
      return {
        skipped: true,
        reason: feed.reason || 'feed_unavailable',
        source: 'detected_deals',
        timezone,
        generatedAt,
        totalSourceDeals: 0,
        todayDeals: 0,
        sections: emptySections,
        outputs: {
          pushNotification: buildPushOutput({ sections: emptySections, generatedAt, timezone }),
          newsletter: buildNewsletterOutput({ sections: emptySections, generatedAt, timezone }),
          socialContents: buildSocialOutput({ sections: emptySections })
        }
      };
    }

    const allItems = collectFeedItems(feed);
    const todayTag = dateKey(now, timezone);
    const todayItems = allItems.filter((item) => dateKey(item?.source_observed_at || item?.published_at, timezone) === todayTag);

    const top5CheapFlightsToday = dedupeDeals([...todayItems].sort(sortByCheap), topCheapLimit);

    const destinationsMap = new Map();
    for (const item of [...allItems].filter((row) => toNumber(row?.price, 0) <= 300).sort(sortByCheap)) {
      const destinationKey = String(item?.destination_iata || item?.destination_city || '').trim().toUpperCase();
      if (!destinationKey || destinationsMap.has(destinationKey)) continue;
      destinationsMap.set(destinationKey, {
        destination_iata: item?.destination_iata || null,
        destination_city: item?.destination_city || null,
        from_price: toNumber(item?.price, 0),
        currency: String(item?.currency || 'EUR').toUpperCase(),
        origin_iata: item?.origin_iata || null,
        destination_iata_raw: destinationKey,
        deal_key: item?.deal_key || null
      });
      if (destinationsMap.size >= destinationsLimit) break;
    }
    const destinationsUnder300 = [...destinationsMap.values()];

    const weekendSource = Array.isArray(feed?.categories?.weekend_flights) ? feed.categories.weekend_flights : allItems.filter((item) => isWeekendDeal(item));
    const weekendLowCost = dedupeDeals([...weekendSource].sort(sortByCheap), weekendLimit);

    let crazyFlightsToday = dedupeDeals([...todayItems].filter((item) => isCrazyDeal(item)).sort(sortByCrazy), crazyLimit);
    if (crazyFlightsToday.length === 0) {
      crazyFlightsToday = dedupeDeals([...todayItems].sort(sortByCrazy), crazyLimit);
    }

    const sections = {
      top5CheapFlightsToday,
      destinationsUnder300,
      weekendLowCost,
      crazyFlightsToday
    };

    return {
      skipped: false,
      reason: null,
      source: 'detected_deals',
      timezone,
      generatedAt,
      totalSourceDeals: allItems.length,
      todayDeals: todayItems.length,
      sections,
      outputs: {
        pushNotification: buildPushOutput({ sections, generatedAt, timezone }),
        newsletter: buildNewsletterOutput({ sections, generatedAt, timezone }),
        socialContents: buildSocialOutput({ sections })
      }
    };
  }

  async function deliverContent(payload, { deliverPush = true, deliverNewsletter = true, deliverSocial = true, deliverInApp = true } = {}) {
    if (payload?.skipped) {
      return {
        push: { attempted: 0, sent: 0, failed: 0, skipped: true, reason: payload.reason || 'source_unavailable' },
        newsletter: { attempted: 0, sent: 0, failed: 0, skipped: true, reason: payload.reason || 'source_unavailable' },
        social: { attempted: 0, sent: 0, failed: 0, skipped: true, reason: payload.reason || 'source_unavailable' },
        inApp: { attempted: 0, sent: 0, failed: 0, skipped: true, reason: payload.reason || 'source_unavailable' }
      };
    }

    const pushDelivery = { attempted: 0, sent: 0, failed: 0, skipped: false, reason: null };
    if (!deliverPush) {
      pushDelivery.skipped = true;
      pushDelivery.reason = 'disabled';
    } else if (!pushWebhookUrl) {
      pushDelivery.skipped = true;
      pushDelivery.reason = 'push_webhook_missing';
    } else {
      const recipients = pushUserIds.length > 0 ? pushUserIds : ['broadcast'];
      pushDelivery.attempted = recipients.length;
      for (const userId of recipients) {
        const result = await postJsonWithRetry({
          fetchFn,
          url: pushWebhookUrl,
          token: pushWebhookToken || null,
          timeoutMs: PUSH_TIMEOUT_MS,
          retries: PUSH_RETRIES,
          retryBaseMs: PUSH_RETRY_BASE_MS,
          payload: {
            userId,
            title: payload.outputs.pushNotification.title,
            message: payload.outputs.pushNotification.message,
            metadata: payload.outputs.pushNotification.metadata,
            sentAt: new Date().toISOString()
          }
        });
        if (result.sent) pushDelivery.sent += 1;
        else pushDelivery.failed += 1;
      }
      if (pushDelivery.failed > 0 && pushDelivery.sent === 0) pushDelivery.reason = 'push_delivery_failed';
      else if (pushDelivery.failed > 0) pushDelivery.reason = 'push_delivery_partial_failure';
    }

    const newsletterDelivery = { attempted: 0, sent: 0, failed: 0, skipped: false, reason: null };
    if (!deliverNewsletter) {
      newsletterDelivery.skipped = true;
      newsletterDelivery.reason = 'disabled';
    } else if (newsletterRecipients.length === 0) {
      newsletterDelivery.skipped = true;
      newsletterDelivery.reason = 'newsletter_recipients_missing';
    } else {
      newsletterDelivery.attempted = newsletterRecipients.length;
      for (const email of newsletterRecipients) {
        try {
          const result = await mailer({
            to: email,
            subject: payload.outputs.newsletter.subject,
            text: payload.outputs.newsletter.text,
            html: payload.outputs.newsletter.html
          });
          const sent = Boolean(result?.sent);
          if (sent) newsletterDelivery.sent += 1;
          else if (!result?.skipped) newsletterDelivery.failed += 1;

          try {
            await emailLogWriter({
              userId: null,
              email,
              subject: payload.outputs.newsletter.subject,
              status: sent ? 'sent' : result?.skipped ? 'skipped' : 'failed',
              providerMessageId: result?.messageId || null,
              errorMessage: result?.reason || null
            });
          } catch {
            // best effort logging
          }
        } catch (error) {
          newsletterDelivery.failed += 1;
          try {
            await emailLogWriter({
              userId: null,
              email,
              subject: payload.outputs.newsletter.subject,
              status: 'failed',
              providerMessageId: null,
              errorMessage: error?.message || 'mail_send_failed'
            });
          } catch {
            // best effort logging
          }
        }
      }
      if (newsletterDelivery.failed > 0 && newsletterDelivery.sent === 0) newsletterDelivery.reason = 'newsletter_delivery_failed';
      else if (newsletterDelivery.failed > 0) newsletterDelivery.reason = 'newsletter_delivery_partial_failure';
    }

    const socialDelivery = { attempted: 0, sent: 0, failed: 0, skipped: false, reason: null };
    if (!deliverSocial) {
      socialDelivery.skipped = true;
      socialDelivery.reason = 'disabled';
    } else if (!socialWebhookUrl) {
      socialDelivery.skipped = true;
      socialDelivery.reason = 'social_webhook_missing';
    } else {
      socialDelivery.attempted = 1;
      const result = await postJsonWithRetry({
        fetchFn,
        url: socialWebhookUrl,
        token: socialWebhookToken || null,
        timeoutMs: SOCIAL_TIMEOUT_MS,
        retries: SOCIAL_RETRIES,
        retryBaseMs: SOCIAL_RETRY_BASE_MS,
        payload: {
          type: 'deals_content_digest',
          source: payload.source,
          generatedAt: payload.generatedAt,
          timezone: payload.timezone,
          sections: payload.sections,
          socialContents: payload.outputs.socialContents
        }
      });
      if (result.sent) socialDelivery.sent = 1;
      else {
        socialDelivery.failed = 1;
        socialDelivery.reason = 'social_delivery_failed';
      }
    }

    const inAppDelivery = { attempted: 0, sent: 0, failed: 0, skipped: false, reason: null };
    if (!deliverInApp) {
      inAppDelivery.skipped = true;
      inAppDelivery.reason = 'disabled';
    } else if (!inAppEnabled) {
      inAppDelivery.skipped = true;
      inAppDelivery.reason = 'inapp_disabled';
    } else if (typeof withDb !== 'function') {
      inAppDelivery.skipped = true;
      inAppDelivery.reason = 'inapp_store_unavailable';
    } else {
      const dayTag = String(payload?.generatedAt || '').slice(0, 10) || dateKey(new Date(), timezone);
      const nowIso = new Date().toISOString();
      try {
        await withDb(async (db) => {
          const users = Array.isArray(db?.users) ? db.users : [];
          if (!Array.isArray(db.notifications)) db.notifications = [];

          const targets = users.filter((user) => String(user?.id || '').trim()).slice(0, inAppMaxUsers);
          inAppDelivery.attempted = targets.length;
          if (targets.length === 0) {
            inAppDelivery.skipped = true;
            inAppDelivery.reason = 'inapp_no_users';
            return db;
          }

          for (const user of targets) {
            const userId = String(user.id).trim();
            const dedupeKey = `deals_content_digest:${userId}:${dayTag}`;
            const alreadySent = db.notifications.some((item) => item?.dedupeKey === dedupeKey);
            if (alreadySent) continue;

            db.notifications.push({
              id: nanoid(12),
              dedupeKey,
              userId,
              createdAt: nowIso,
              readAt: null,
              title: payload.outputs.pushNotification.title,
              message: payload.outputs.pushNotification.message,
              data: {
                type: 'deals_content_digest',
                generatedAt: payload.generatedAt,
                timezone: payload.timezone,
                sectionCounts: {
                  top5CheapFlightsToday: payload.sections.top5CheapFlightsToday.length,
                  destinationsUnder300: payload.sections.destinationsUnder300.length,
                  weekendLowCost: payload.sections.weekendLowCost.length,
                  crazyFlightsToday: payload.sections.crazyFlightsToday.length
                }
              }
            });
            inAppDelivery.sent += 1;
          }

          db.notifications = db.notifications.slice(-6000);
          if (inAppDelivery.sent === 0) {
            inAppDelivery.reason = 'inapp_already_sent';
          }
          return db;
        });
      } catch (error) {
        inAppDelivery.failed = Math.max(1, inAppDelivery.attempted || 1);
        inAppDelivery.reason = error?.message || 'inapp_delivery_failed';
      }
    }

    return {
      push: pushDelivery,
      newsletter: newsletterDelivery,
      social: socialDelivery,
      inApp: inAppDelivery
    };
  }

  async function runOnce(options = {}) {
    const payload = await generateContent(options);
    const shouldDeliver = options.deliver !== false;
    const delivery = await deliverContent(payload, {
      deliverPush: shouldDeliver && options.deliverPush !== false,
      deliverNewsletter: shouldDeliver && options.deliverNewsletter !== false,
      deliverSocial: shouldDeliver && options.deliverSocial !== false,
      deliverInApp: shouldDeliver && options.deliverInApp !== false
    });

    const summary = {
      skipped: payload.skipped,
      reason: payload.reason || null,
      source: payload.source,
      generatedAt: payload.generatedAt,
      timezone: payload.timezone,
      totalSourceDeals: Number(payload.totalSourceDeals || 0),
      todayDeals: Number(payload.todayDeals || 0),
      sectionCounts: {
        top5CheapFlightsToday: payload.sections.top5CheapFlightsToday.length,
        destinationsUnder300: payload.sections.destinationsUnder300.length,
        weekendLowCost: payload.sections.weekendLowCost.length,
        crazyFlightsToday: payload.sections.crazyFlightsToday.length
      },
      delivery
    };

    logger.info(summary, 'deals_content_engine_completed');
    return { ...payload, delivery, summary };
  }

  return {
    generateContent,
    deliverContent,
    runOnce
  };
}

let singleton = null;

export function getDealsContentEngine() {
  if (!singleton) singleton = createDealsContentEngine();
  return singleton;
}

export async function runDealsContentEngineOnce(options = {}) {
  return getDealsContentEngine().runOnce(options);
}
