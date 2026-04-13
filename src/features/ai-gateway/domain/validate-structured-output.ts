import { z } from 'zod';
import type { AiTaskType } from '../types/ai-task-type.ts';

const IATA_CODE_PATTERN = /^[A-Z]{3}$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const ItineraryIdSchema = z.string().trim().min(1).max(80);
const IataCodeSchema = z.string().trim().toUpperCase().regex(IATA_CODE_PATTERN);
const IsoDateSchema = z.string().trim().regex(ISO_DATE_PATTERN);

const ItineraryGenerationItemSchema = z.object({
  id: ItineraryIdSchema,
  viewItineraryId: ItineraryIdSchema,
  origin: IataCodeSchema,
  destination: z.string().trim().min(1).max(120),
  destinationIata: IataCodeSchema,
  price: z.number().finite().min(0).max(1_000_000),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
  dateFrom: IsoDateSchema,
  dateTo: z.union([IsoDateSchema, z.literal('')]).optional().default(''),
  stops: z.number().int().min(0).max(6).nullable().optional(),
  rankingScore: z.number().finite().min(0).max(100),
  explanation: z.string().trim().min(4).max(220)
});

const ItineraryGenerationOutputSchema = z.object({
  summary: z.string().trim().min(1).max(320),
  items: z.array(ItineraryGenerationItemSchema).max(20),
  totalItems: z.number().int().min(0).max(1_000),
  truncatedByPlan: z.boolean()
}).superRefine((payload, ctx) => {
  if (payload.totalItems < payload.items.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['totalItems'],
      message: 'totalItems cannot be lower than items length.'
    });
  }
});

export type ValidatedItineraryGenerationOutput = z.infer<typeof ItineraryGenerationOutputSchema>;

export interface StructuredOutputValidationResult<TData = unknown> {
  valid: boolean;
  data: TData | null;
  errorMessage?: string;
}

export function validateStructuredOutput(
  taskType: AiTaskType,
  payload: unknown
): StructuredOutputValidationResult {
  if (taskType !== 'itinerary_generation') {
    return {
      valid: true,
      data: payload
    };
  }
  const result = ItineraryGenerationOutputSchema.safeParse(payload);
  if (!result.success) {
    return {
      valid: false,
      data: null,
      errorMessage: result.error.issues.map((issue) => issue.message).join('; ') || 'Invalid structured output.'
    };
  }
  return {
    valid: true,
    data: result.data
  };
}
