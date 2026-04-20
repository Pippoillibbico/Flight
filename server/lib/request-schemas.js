import { z } from 'zod';

export const REGION_ENUM = ['all', 'eu', 'asia', 'america', 'oceania'];
export const CABIN_ENUM = ['economy', 'premium', 'business'];
export const CONNECTION_ENUM = ['all', 'direct', 'with_stops'];
export const TRAVEL_TIME_ENUM = ['all', 'day', 'night'];

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email().max(254),
  password: z
    .string()
    .min(10)
    .max(64)
    .regex(/[a-z]/, 'Password must include a lowercase letter.')
    .regex(/[A-Z]/, 'Password must include an uppercase letter.')
    .regex(/[0-9]/, 'Password must include a number.')
    .regex(/[^A-Za-z0-9]/, 'Password must include a special character.')
}).strict();

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(8).max(64)
}).strict();

export const passwordResetRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254)
}).strict();

export const passwordResetConfirmSchema = z.object({
  token: z.string().trim().min(32).max(256),
  password: z
    .string()
    .min(10)
    .max(64)
    .regex(/[a-z]/, 'Password must include a lowercase letter.')
    .regex(/[A-Z]/, 'Password must include an uppercase letter.')
    .regex(/[0-9]/, 'Password must include a number.')
    .regex(/[^A-Za-z0-9]/, 'Password must include a special character.')
}).strict();

export const emailVerifySchema = z.object({
  token: z.string().trim().min(32).max(256)
}).strict();

export const mfaCodeSchema = z.object({
  code: z.string().trim().min(6).max(8)
}).strict();

export const loginMfaVerifySchema = z.object({
  ticket: z.string().min(10).max(80),
  code: z.string().trim().min(6).max(8)
}).strict();

export const onboardingCompleteSchema = z.object({
  intent: z.enum(['deals', 'family', 'business', 'weekend']).optional(),
  budget: z.number().int().positive().max(20000).optional(),
  preferredRegion: z.enum(REGION_ENUM).optional(),
  directOnly: z.boolean().optional()
}).strict();

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isStrictIsoDate(value) {
  const text = String(value || '').trim();
  if (!ISO_DATE_PATTERN.test(text)) return false;
  const parsed = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.toISOString().slice(0, 10) === text;
}

const multiCitySegmentSchema = z.object({
  origin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, 'Invalid segment origin IATA code.'),
  destination: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, 'Invalid segment destination IATA code.'),
  date: z.string().trim().regex(ISO_DATE_PATTERN, 'Invalid segment date format. Use YYYY-MM-DD.')
}).strict();

export const searchSchema = z
  .object({
    origin: z.string().min(3).max(3),
    region: z.enum(REGION_ENUM),
    country: z.preprocess(
      (value) => {
        const text = String(value ?? '').trim();
        return text === '' ? undefined : text;
      },
      z.string().min(1).max(80).optional()
    ),
    destinationQuery: z.preprocess(
      (value) => {
        const text = String(value ?? '').trim();
        return text === '' ? undefined : text;
      },
      z.string().min(1).max(80).optional()
    ),
    dateFrom: z.string(),
    dateTo: z.string().optional(),
    cheapOnly: z.boolean(),
    maxBudget: z.number().int().positive().optional(),
    connectionType: z.enum(CONNECTION_ENUM),
    maxStops: z.number().int().min(0).max(2).optional(),
    travelTime: z.enum(TRAVEL_TIME_ENUM),
    minComfortScore: z.number().int().min(1).max(100).optional(),
    travellers: z.number().int().min(1).max(9),
    cabinClass: z.enum(CABIN_ENUM),
    mode: z.enum(['single', 'multi_city']).optional(),
    segments: z.array(multiCitySegmentSchema).min(2).max(6).optional()
  })
  .strict()
  .superRefine((payload, ctx) => {
    const mode = payload.mode === 'multi_city' ? 'multi_city' : 'single';
    if (mode === 'multi_city') {
      if (!Array.isArray(payload.segments) || payload.segments.length < 2 || payload.segments.length > 6) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Multi-city search requires 2 to 6 segments.'
        });
        return;
      }

      let previousDate = null;
      for (let index = 0; index < payload.segments.length; index += 1) {
        const segment = payload.segments[index];
        if (!isStrictIsoDate(segment.date)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['segments', index, 'date'],
            message: 'Invalid segment date.'
          });
          continue;
        }
        const currentDate = new Date(segment.date);
        if (segment.origin === segment.destination) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['segments', index, 'destination'],
            message: 'Origin and destination cannot be the same in a segment.'
          });
        }
        if (previousDate && currentDate < previousDate) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['segments', index, 'date'],
            message: 'Segment dates cannot be in reverse order.'
          });
        }
        previousDate = currentDate;
      }
      return;
    }

    const from = new Date(payload.dateFrom);
    const to = payload.dateTo ? new Date(payload.dateTo) : null;
    if (Number.isNaN(from.getTime()) || (to && Number.isNaN(to.getTime()))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid travel dates.' });
      return;
    }
    if (to && to <= from) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Return date must be after departure date.' });
    }
  });

export const justGoSchema = z
  .object({
    origin: z.string().min(3).max(3),
    region: z.enum(REGION_ENUM).optional(),
    country: z.preprocess(
      (value) => {
        const text = String(value ?? '').trim();
        return text === '' ? undefined : text;
      },
      z.string().min(1).max(80).optional()
    ),
    dateFrom: z.string(),
    dateTo: z.string(),
    tripLengthDays: z.number().int().min(2).max(21),
    budgetMax: z.number().int().min(150).max(25000),
    travellers: z.number().int().min(1).max(9),
    cabinClass: z.enum(CABIN_ENUM),
    mood: z.enum(['relax', 'natura', 'party', 'cultura', 'avventura']),
    climatePreference: z.enum(['warm', 'mild', 'cold', 'indifferent']),
    pace: z.enum(['slow', 'normal', 'fast']),
    avoidOvertourism: z.boolean().optional(),
    packageCount: z.union([z.literal(3), z.literal(4)]).optional(),
    aiProvider: z.enum(['none', 'chatgpt', 'claude', 'auto']).optional()
  })
  .strict()
  .superRefine((payload, ctx) => {
    const from = new Date(payload.dateFrom);
    const to = new Date(payload.dateTo);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid travel dates.' });
      return;
    }
    if (to <= from) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Return date must be after departure date.' });
    }
  });

export const decisionIntakeSchema = z.object({
  prompt: z.string().trim().min(6).max(1200),
  aiProvider: z.enum(['none', 'chatgpt', 'claude', 'auto']).optional(),
  packageCount: z.union([z.literal(3), z.literal(4)]).optional()
}).strict();

export const watchlistSchema = z.object({
  flightId: z.string().min(1),
  destination: z.string().min(1),
  destinationIata: z.string().min(3).max(3),
  price: z.number().positive(),
  dateFrom: z.string(),
  dateTo: z.string(),
  link: z.string().url()
}).strict();

export const alertSubscriptionSchema = z.object({
  origin: z.string().min(3).max(3),
  region: z.enum(REGION_ENUM),
  country: z.preprocess(
    (value) => {
      const text = String(value ?? '').trim();
      return text === '' ? undefined : text;
    },
    z.string().min(1).max(80).optional()
  ),
  destinationQuery: z.preprocess(
    (value) => {
      const text = String(value ?? '').trim();
      return text === '' ? undefined : text;
    },
    z.string().min(1).max(80).optional()
  ),
  destinationIata: z.string().length(3).optional(),
  targetPrice: z.number().int().positive().optional(),
  connectionType: z.enum(CONNECTION_ENUM),
  maxStops: z.number().int().min(0).max(2).optional(),
  travelTime: z.enum(TRAVEL_TIME_ENUM),
  minComfortScore: z.number().int().min(1).max(100).optional(),
  cheapOnly: z.boolean(),
  travellers: z.number().int().min(1).max(9),
  cabinClass: z.enum(CABIN_ENUM),
  stayDays: z.number().int().min(2).max(30),
  daysFromNow: z.number().int().min(1).max(180).optional()
}).strict();

export const alertSubscriptionUpdateSchema = z
  .object({
    enabled: z.boolean().optional(),
    targetPrice: z.number().int().positive().nullable().optional(),
    connectionType: z.enum(CONNECTION_ENUM).optional(),
    maxStops: z.number().int().min(0).max(2).nullable().optional(),
    travelTime: z.enum(TRAVEL_TIME_ENUM).optional(),
    minComfortScore: z.number().int().min(1).max(100).nullable().optional(),
    cheapOnly: z.boolean().optional(),
    travellers: z.number().int().min(1).max(9).optional(),
    cabinClass: z.enum(CABIN_ENUM).optional(),
    stayDays: z.number().int().min(2).max(30).optional(),
    daysFromNow: z.number().int().min(1).max(180).nullable().optional()
  })
  .strict()
  .refine((payload) => Object.keys(payload).length > 0, {
    message: 'No update field provided.'
  });

export const destinationInsightSchema = z
  .object({
    origin: z.string().min(3).max(3),
    region: z.enum(REGION_ENUM),
    country: z.preprocess(
      (value) => {
        const text = String(value ?? '').trim();
        return text === '' ? undefined : text;
      },
      z.string().min(1).max(80).optional()
    ),
    destinationQuery: z.preprocess(
      (value) => {
        const text = String(value ?? '').trim();
        return text === '' ? undefined : text;
      },
      z.string().min(1).max(80).optional()
    ),
    destinationIata: z.preprocess(
      (value) => {
        const text = String(value ?? '').trim();
        return text === '' ? undefined : text.toUpperCase();
      },
      z.string().length(3).optional()
    ),
    cheapOnly: z.boolean(),
    maxBudget: z.number().int().positive().optional(),
    connectionType: z.enum(CONNECTION_ENUM),
    maxStops: z.number().int().min(0).max(2).optional(),
    travelTime: z.enum(TRAVEL_TIME_ENUM),
    minComfortScore: z.number().int().min(1).max(100).optional(),
    travellers: z.number().int().min(1).max(9),
    cabinClass: z.enum(CABIN_ENUM),
    stayDays: z.number().int().min(2).max(30),
    horizonDays: z.number().int().min(7).max(180).optional()
  })
  .strict()
  .superRefine((payload, ctx) => {
    if (!payload.destinationQuery && !payload.destinationIata) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide destinationQuery or destinationIata.'
      });
    }
  });

export const ADMIN_TELEMETRY_EVENT_TYPES = [
  'result_interaction_clicked',
  'itinerary_opened',
  'booking_clicked',
  'live_deal_feed_view',
  'live_deal_card_click',
  'live_deal_detail_open',
  'live_deal_pre_redirect_open',
  'live_deal_redirect_confirm',
  'live_deal_return_view',
  'live_deal_save_route_click',
  'live_deal_alert_click',
  'upgrade_cta_shown',
  'upgrade_cta_clicked',
  'elite_cta_clicked',
  'upgrade_modal_opened',
  'elite_modal_opened',
  'upgrade_primary_cta_clicked',
  'checkout_started',
  'checkout_completed',
  'radar_activated',
  'trial_banner_shown',
  'trial_upgrade_clicked'
];

const ADMIN_TELEMETRY_SOURCE_CONTEXT = ['web_app', 'admin_backoffice', 'api_client'];

export const adminTelemetryEventSchema = z.object({
  eventType: z.enum(ADMIN_TELEMETRY_EVENT_TYPES),
  at: z.string().datetime().optional(),
  eventId: z.string().regex(/^[a-z0-9_-]{8,80}$/i).optional(),
  fingerprint: z.string().regex(/^[a-z0-9_-]{12,128}$/i).optional(),
  eventVersion: z.number().int().min(1).max(10).optional(),
  schemaVersion: z.number().int().min(1).max(10).optional(),
  sourceContext: z.enum(ADMIN_TELEMETRY_SOURCE_CONTEXT).optional(),
  action: z.string().max(80).optional(),
  surface: z.string().max(80).optional(),
  itineraryId: z.string().max(120).optional(),
  correlationId: z.string().max(180).optional(),
  source: z.string().max(120).optional(),
  routeSlug: z.string().max(120).optional(),
  dealId: z.string().max(120).optional(),
  sessionId: z.string().max(120).optional(),
  price: z.number().positive().max(100000).optional(),
  planType: z.enum(['free', 'pro', 'elite']).optional()
}).strict();
