import type { IsoDate, MultiCitySegment, MultiCitySegmentField } from '../types/index.ts';
import { normalizeIsoDate } from '../validation/validate-multi-city.ts';

function createSegmentId(index: number): string {
  return `segment-${index + 1}`;
}

function parseSegmentNumericId(value: string): number {
  const text = String(value || '').trim();
  const match = text.match(/^segment-(\d+)$/);
  if (!match) return -1;
  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed)) return -1;
  return parsed;
}

function nextSegmentIdFromList(segments: MultiCitySegment[]): string {
  let maxNumericId = 0;
  for (const segment of segments) {
    const numericId = parseSegmentNumericId(segment.id);
    if (numericId > maxNumericId) maxNumericId = numericId;
  }
  return `segment-${maxNumericId + 1}`;
}

function nextDate(value: string): IsoDate {
  if (!value) return '';
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return '';
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
}

export function createDefaultMultiCitySegments(dateFrom = '', dateTo = ''): MultiCitySegment[] {
  const firstDate = normalizeIsoDate(dateFrom);
  const secondDate = normalizeIsoDate(dateTo) || nextDate(firstDate);
  return [
    {
      id: createSegmentId(0),
      origin: '',
      destination: '',
      date: firstDate
    },
    {
      id: createSegmentId(1),
      origin: '',
      destination: '',
      date: secondDate
    }
  ];
}

export function addMultiCitySegment(segments: MultiCitySegment[]): MultiCitySegment[] {
  const safe = Array.isArray(segments) ? segments : [];
  if (safe.length < 2) return createDefaultMultiCitySegments();
  if (safe.length >= 6) return safe;
  const last = safe[safe.length - 1];
  return [
    ...safe,
    {
      id: nextSegmentIdFromList(safe),
      origin: last?.destination || '',
      destination: '',
      date: nextDate(last?.date || '')
    }
  ];
}

export function removeMultiCitySegment(segments: MultiCitySegment[], index: number): MultiCitySegment[] {
  const safe = Array.isArray(segments) ? segments : [];
  if (safe.length <= 2) return safe;
  if (index < 0 || index >= safe.length) return safe;
  return safe.filter((_, currentIndex) => currentIndex !== index);
}

export function updateMultiCitySegmentField(
  segments: MultiCitySegment[],
  index: number,
  field: MultiCitySegmentField,
  value: string
): MultiCitySegment[] {
  const safe = Array.isArray(segments) ? segments : [];
  return safe.map((segment, currentIndex) => {
    if (currentIndex !== index) return segment;
    if (field === 'date') return { ...segment, date: normalizeIsoDate(value) };
    const normalized = String(value || '')
      .trim()
      .toUpperCase();
    return { ...segment, [field]: normalized };
  });
}
