import { z } from 'zod';

const iataSchema = z.string().trim().min(3).max(3).transform((value) => value.toUpperCase());

export const triangulationPeriodSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('month'), month: z.string().regex(/^\d{4}-\d{2}$/) }),
  z.object({
    type: z.literal('date_range'),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
  })
]);

export const triangulationIntakeSchema = z.object({
  prompt: z.string().trim().min(8).max(1200),
  aiProvider: z.enum(['auto', 'openai', 'anthropic', 'none']).optional().default('auto'),
  baggage: z.enum(['personal_item', 'cabin_bag', 'checked']).optional().default('personal_item'),
  riskTolerance: z.enum(['low', 'medium', 'high']).optional().default('medium')
});

export const triangulationSearchSchema = z.object({
  origin: iataSchema,
  destination: iataSchema,
  destinationArea: z.string().trim().max(80).optional(),
  period: triangulationPeriodSchema,
  flexibility: z.enum(['fixed_date', 'weekend', 'flexible_dates', 'full_month']).optional().default('full_month'),
  goal: z.enum(['lowest_price', 'balanced', 'comfort']).optional().default('lowest_price'),
  strategy: z.enum(['triangulation', 'baseline']).optional().default('triangulation'),
  maxBridgeStops: z.coerce.number().int().min(1).max(2).optional().default(1),
  baggage: z.enum(['personal_item', 'cabin_bag', 'checked']).optional().default('personal_item'),
  riskTolerance: z.enum(['low', 'medium', 'high']).optional().default('medium'),
  travellers: z.coerce.number().int().min(1).max(9).optional().default(1),
  cabinClass: z.enum(['economy', 'premium_economy', 'business', 'first']).optional().default('economy')
});

export function normalizeTriangulationSearchInput(input) {
  return triangulationSearchSchema.parse(input);
}
