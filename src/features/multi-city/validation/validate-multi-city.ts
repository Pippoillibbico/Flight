import type {
  IsoDate,
  MultiCityFormState,
  MultiCitySegment,
  MultiCityValidationResult,
  SegmentFieldErrors
} from '../types/index.ts';

const IATA_CODE = /^[A-Z]{3}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeIata(value: string): string {
  return String(value || '').trim().toUpperCase();
}

export function normalizeIsoDate(value: string): IsoDate {
  return String(value || '').trim();
}

export function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.toISOString().slice(0, 10) === value;
}

export function normalizeMultiCitySegment(segment: MultiCitySegment): MultiCitySegment {
  return {
    ...segment,
    origin: normalizeIata(segment.origin),
    destination: normalizeIata(segment.destination),
    date: normalizeIsoDate(segment.date)
  };
}

export function validateMultiCityForm(input: MultiCityFormState): MultiCityValidationResult {
  const segments = Array.isArray(input?.segments) ? input.segments.map(normalizeMultiCitySegment) : [];
  const segmentErrors: SegmentFieldErrors[] = segments.map(() => ({}));
  const formErrors: string[] = [];

  if (segments.length < 2 || segments.length > 6) {
    formErrors.push('Itinerary must include between 2 and 6 segments.');
  }

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const errors = segmentErrors[index];
    if (!segment || !errors) continue;

    if (!segment.origin) errors.origin = 'Origin is required.';
    else if (!IATA_CODE.test(segment.origin)) errors.origin = 'Origin must be a 3-letter IATA code.';

    if (!segment.destination) errors.destination = 'Destination is required.';
    else if (!IATA_CODE.test(segment.destination)) errors.destination = 'Destination must be a 3-letter IATA code.';

    if (!segment.date) errors.date = 'Date is required.';
    else if (!isValidIsoDate(segment.date)) errors.date = 'Date must be a valid YYYY-MM-DD value.';

    if (segment.origin && segment.destination && segment.origin === segment.destination) {
      errors.destination = 'Origin and destination cannot be the same.';
    }

    if (index > 0) {
      const prev = segments[index - 1];
      if (prev && isValidIsoDate(segment.date) && isValidIsoDate(prev.date) && segment.date < prev.date) {
        errors.date = 'Segment date cannot be earlier than previous segment.';
      }
    }
  }

  const hasFieldErrors = segmentErrors.some((entry) => Object.values(entry).some(Boolean));
  const valid = !hasFieldErrors && formErrors.length === 0;

  return {
    valid,
    segmentErrors,
    formErrors
  };
}
