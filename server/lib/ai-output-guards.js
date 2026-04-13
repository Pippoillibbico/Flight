import { z } from 'zod';

const DECISION_ITEMS_MAX = 12;
const MAX_AI_JSON_TEXT_LENGTH = 25_000;
const ALLOWED_MOODS = new Set(['relax', 'natura', 'party', 'cultura', 'avventura']);
const ALLOWED_CLIMATE = new Set(['warm', 'mild', 'cold', 'indifferent']);
const ALLOWED_PACE = new Set(['slow', 'normal', 'fast']);
const ALLOWED_REGION = new Set(['all', 'eu', 'asia', 'america', 'oceania']);

const decisionAiPayloadSchema = z.object({
  items: z
    .array(
      z.object({
        destinationIata: z.string(),
        whyNow: z.string().optional(),
        riskNote: z.string().optional()
      })
    )
    .max(DECISION_ITEMS_MAX)
    .default([])
});

const intentAiPayloadSchema = z.object({
  preferences: z.record(z.string(), z.unknown()).optional().default({}),
  summary: z.string().optional().default('')
});

const opportunityEnrichmentPayloadSchema = z.object({
  ai_title: z.string().optional().default(''),
  ai_description: z.string().optional().default(''),
  notification_text: z.string().optional().default(''),
  why_it_matters: z.string().optional().default(''),
  short_badge_text: z.string().optional().default('')
});

function cleanModelText(value, maxLength) {
  const normalized = String(value || '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return '';
  return normalized.slice(0, Math.max(1, Number(maxLength) || 80));
}

function toFiniteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toBoundedInt(value, min, max) {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return null;
  return Math.max(min, Math.min(max, parsed));
}

export function extractJsonObject(text) {
  const raw = String(text || '').trim();
  if (raw.length > MAX_AI_JSON_TEXT_LENGTH) return null;
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {}
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  if (end - start + 1 > MAX_AI_JSON_TEXT_LENGTH) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

export function parseDecisionAiPayload(rawPayload) {
  const parsed = decisionAiPayloadSchema.safeParse(rawPayload);
  if (!parsed.success) return [];

  const output = [];
  for (const item of parsed.data.items || []) {
    const destinationIata = cleanModelText(item.destinationIata, 16).toUpperCase();
    if (!/^[A-Z]{3}$/.test(destinationIata)) continue;
    output.push({
      destinationIata,
      whyNow: cleanModelText(item.whyNow, 220),
      riskNote: cleanModelText(item.riskNote, 180)
    });
  }
  return output;
}

function sanitizeIntentPreferences(rawPreferences) {
  const source = rawPreferences && typeof rawPreferences === 'object' && !Array.isArray(rawPreferences) ? rawPreferences : {};
  const preferences = {};

  const origin = cleanModelText(source.origin, 3).toUpperCase();
  if (/^[A-Z]{3}$/.test(origin)) preferences.origin = origin;

  const budgetMax = toFiniteNumber(source.budgetMax);
  if (budgetMax !== null && budgetMax >= 50 && budgetMax <= 50_000) {
    preferences.budgetMax = Math.round(budgetMax);
  }

  const tripLengthDays = toBoundedInt(source.tripLengthDays, 2, 30);
  if (tripLengthDays !== null) preferences.tripLengthDays = tripLengthDays;

  const mood = cleanModelText(source.mood, 16).toLowerCase();
  if (ALLOWED_MOODS.has(mood)) preferences.mood = mood;

  const climatePreference = cleanModelText(source.climatePreference, 16).toLowerCase();
  if (ALLOWED_CLIMATE.has(climatePreference)) preferences.climatePreference = climatePreference;

  const pace = cleanModelText(source.pace, 16).toLowerCase();
  if (ALLOWED_PACE.has(pace)) preferences.pace = pace;

  if (typeof source.avoidOvertourism === 'boolean') {
    preferences.avoidOvertourism = source.avoidOvertourism;
  }

  const region = cleanModelText(source.region, 16).toLowerCase();
  if (ALLOWED_REGION.has(region)) preferences.region = region;

  const packageCount = toBoundedInt(source.packageCount, 3, 4);
  if (packageCount === 3 || packageCount === 4) preferences.packageCount = packageCount;

  return preferences;
}

export function parseIntentAiPayload(rawPayload) {
  const parsed = intentAiPayloadSchema.safeParse(rawPayload);
  if (!parsed.success) return null;

  return {
    preferences: sanitizeIntentPreferences(parsed.data.preferences),
    summary: cleanModelText(parsed.data.summary, 320)
  };
}

export function resolveOpportunityEnrichmentPayload(rawPayload, fallback, fallbackBadgeText = '') {
  const parsed = opportunityEnrichmentPayloadSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return {
      aiTitle: cleanModelText(fallback?.aiTitle, 180),
      aiDescription: cleanModelText(fallback?.aiDescription, 280),
      notificationText: cleanModelText(fallback?.notificationText, 180),
      whyItMatters: cleanModelText(fallback?.whyItMatters, 220),
      shortBadgeText: cleanModelText(fallbackBadgeText, 48)
    };
  }

  return {
    aiTitle: cleanModelText(parsed.data.ai_title, 180) || cleanModelText(fallback?.aiTitle, 180),
    aiDescription: cleanModelText(parsed.data.ai_description, 280) || cleanModelText(fallback?.aiDescription, 280),
    notificationText: cleanModelText(parsed.data.notification_text, 180) || cleanModelText(fallback?.notificationText, 180),
    whyItMatters: cleanModelText(parsed.data.why_it_matters, 220) || cleanModelText(fallback?.whyItMatters, 220),
    shortBadgeText: cleanModelText(parsed.data.short_badge_text, 48) || cleanModelText(fallbackBadgeText, 48)
  };
}
