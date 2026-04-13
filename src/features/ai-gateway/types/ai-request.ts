import type { UserPlan } from '../../monetization/types/index.ts';
import type { AiModel } from './ai-model.ts';
import type { AiProvider } from './ai-provider.ts';
import type { AiTaskType } from './ai-task-type.ts';

export type AiStructuredSchemaKey = 'itinerary_generation';

export interface AiGatewayRequest<TInput = unknown> {
  taskType: AiTaskType;
  planType: UserPlan;
  input: TInput;
  requestId?: string;
  preferredProvider?: AiProvider;
  preferredModel?: AiModel;
  maxOutputTokens?: number;
  schemaKey?: AiStructuredSchemaKey | null;
}

export interface AiAdapterRequest<TInput = unknown> {
  taskType: AiTaskType;
  planType: UserPlan;
  model: AiModel;
  provider: AiProvider;
  input: TInput;
  maxOutputTokens: number;
  requestId: string;
}
