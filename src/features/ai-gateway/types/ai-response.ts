import type { AiModel } from './ai-model.ts';
import type { AiProvider } from './ai-provider.ts';
import type { AiTaskType } from './ai-task-type.ts';

export type AiGatewayErrorCode =
  | 'blocked_by_policy'
  | 'provider_failed'
  | 'structured_output_invalid'
  | 'adapter_not_available';

export type AiGatewayBlockReason =
  | 'max_requests_per_session'
  | 'max_estimated_cost_per_session'
  | 'max_output_tokens_per_request'
  | 'max_task_executions_per_plan';

export interface AiGatewayError {
  code: AiGatewayErrorCode;
  message: string;
  blockReason?: AiGatewayBlockReason;
}

export interface AiGatewayTelemetry {
  provider: AiProvider | null;
  model: AiModel | null;
  taskType: AiTaskType;
  usedFallback: boolean;
  estimatedCost: number;
  blockedByPolicy: boolean;
  blockReason?: AiGatewayBlockReason;
}

export interface AiGatewayResult<TData = unknown> {
  ok: boolean;
  data: TData | null;
  error: AiGatewayError | null;
  telemetry: AiGatewayTelemetry;
}

export interface AiProviderResult<TData = unknown> {
  ok: boolean;
  data: TData | null;
  errorCode?: string;
  errorMessage?: string;
}
