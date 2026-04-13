export type SearchMode = 'single' | 'multi_city';

export type IataCode = string;
export type IsoDate = string;
export type MultiCitySegmentField = 'origin' | 'destination' | 'date';

export interface MultiCitySegment {
  id: string;
  origin: IataCode;
  destination: IataCode;
  date: IsoDate;
}

export interface MultiCityFormState {
  segments: MultiCitySegment[];
}

export interface SegmentFieldErrors {
  origin?: string;
  destination?: string;
  date?: string;
}

export interface MultiCityValidationResult {
  valid: boolean;
  segmentErrors: SegmentFieldErrors[];
  formErrors: string[];
}

export interface MultiCityValidationError {
  message: string;
  field?: MultiCitySegmentField;
  segmentIndex?: number;
}

export interface MultiCitySearchSegmentPayload {
  origin: IataCode;
  destination: IataCode;
  date: IsoDate;
}

export interface MultiCitySearchPayload {
  mode: 'multi_city';
  segments: MultiCitySearchSegmentPayload[];
  region?: string;
  country?: string;
  cheapOnly?: boolean;
  maxBudget?: number;
  connectionType?: string;
  maxStops?: number;
  travelTime?: string;
  minComfortScore?: number;
  travellers?: number;
  cabinClass?: string;
  origin: string;
  destinationQuery?: string;
  dateFrom: string;
  dateTo?: string;
}

export interface MultiCityPayloadOptions {
  originFallback?: string;
  destinationQueryFallback?: string;
  region?: string;
  country?: string;
  cheapOnly?: boolean;
  maxBudget?: number;
  connectionType?: string;
  maxStops?: number;
  travelTime?: string;
  minComfortScore?: number;
  travellers?: number;
  cabinClass?: string;
}

export interface MultiCityRetryPolicy {
  maxAttempts: number;
  initialDelayMs: number;
}
