import { z } from 'zod';

const FOLLOW_METADATA_MAX_KEYS = 12;
const FOLLOW_METADATA_MAX_STRING_LENGTH = 120;
const FOLLOW_METADATA_MAX_ARRAY_ITEMS = 8;
const FOLLOW_METADATA_MAX_SERIALIZED_LENGTH = 2048;

function cleanText(value, maxLength = FOLLOW_METADATA_MAX_STRING_LENGTH) {
  const normalized = String(value || '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return '';
  return normalized.slice(0, Math.max(1, maxLength));
}

function sanitizePrimitive(value) {
  if (typeof value === 'boolean') return value;
  if (value === null) return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return undefined;
    if (Math.abs(value) > 1_000_000_000) return undefined;
    return Math.round(value * 1000) / 1000;
  }
  if (typeof value === 'string') {
    const cleaned = cleanText(value);
    return cleaned ? cleaned : undefined;
  }
  return undefined;
}

function sanitizeValue(value) {
  const primitive = sanitizePrimitive(value);
  if (primitive !== undefined) return primitive;
  if (!Array.isArray(value)) return undefined;

  const normalized = [];
  for (const item of value) {
    if (normalized.length >= FOLLOW_METADATA_MAX_ARRAY_ITEMS) break;
    const safeItem = sanitizePrimitive(item);
    if (safeItem === undefined) continue;
    normalized.push(safeItem);
  }
  return normalized.length > 0 ? normalized : undefined;
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null;
}

export function sanitizeFollowMetadata(input) {
  if (!isPlainObject(input)) return {};

  const output = {};
  let usedKeys = 0;
  for (const [rawKey, rawValue] of Object.entries(input)) {
    if (usedKeys >= FOLLOW_METADATA_MAX_KEYS) break;
    const key = cleanText(rawKey, 40);
    if (!key) continue;
    const value = sanitizeValue(rawValue);
    if (value === undefined) continue;
    output[key] = value;
    usedKeys += 1;
  }

  try {
    const serialized = JSON.stringify(output);
    if (serialized.length <= FOLLOW_METADATA_MAX_SERIALIZED_LENGTH) return output;
  } catch {
    return {};
  }

  const truncated = {};
  for (const [key, value] of Object.entries(output)) {
    truncated[key] = value;
    try {
      if (JSON.stringify(truncated).length > FOLLOW_METADATA_MAX_SERIALIZED_LENGTH) {
        delete truncated[key];
        break;
      }
    } catch {
      delete truncated[key];
      break;
    }
  }
  return truncated;
}

const followMetadataValueSchema = z.union([
  z.string().trim().min(1).max(FOLLOW_METADATA_MAX_STRING_LENGTH),
  z.number().finite().min(-1_000_000_000).max(1_000_000_000),
  z.boolean(),
  z.null(),
  z
    .array(
      z.union([
        z.string().trim().min(1).max(FOLLOW_METADATA_MAX_STRING_LENGTH),
        z.number().finite().min(-1_000_000_000).max(1_000_000_000),
        z.boolean(),
        z.null()
      ])
    )
    .max(FOLLOW_METADATA_MAX_ARRAY_ITEMS)
]);

export const followMetadataSchema = z
  .record(z.string().trim().min(1).max(40), followMetadataValueSchema)
  .superRefine((value, ctx) => {
    if (Object.keys(value).length > FOLLOW_METADATA_MAX_KEYS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Metadata supports up to ${FOLLOW_METADATA_MAX_KEYS} keys.`
      });
    }
    try {
      if (JSON.stringify(value).length > FOLLOW_METADATA_MAX_SERIALIZED_LENGTH) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Metadata is too large.'
        });
      }
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Metadata is not serializable.'
      });
    }
  })
  .transform((value) => sanitizeFollowMetadata(value));
