export type ItinerarySourceType = 'search_result' | 'opportunity_feed';
export type GeneratedItineraryType = 'single' | 'multi_city';

export type GenerationBudgetSensitivity = 'high' | 'balanced' | 'low';
export type GenerationValuePreference = 'value_focus' | 'balanced';
export type GenerationComfortPreference = 'high' | 'balanced' | 'flexible';

export interface ItineraryGenerationPreferences {
  origin?: string;
  maxStops?: number | null;
  maxBudget?: number | null;
  minComfortScore?: number | null;
  budgetSensitivity?: GenerationBudgetSensitivity;
  valuePreference?: GenerationValuePreference;
  comfortPreference?: GenerationComfortPreference;
  multiCityEnabled?: boolean;
  limit?: number;
}

export interface ItineraryGenerationInput {
  id: string;
  sourceType: ItinerarySourceType;
  origin?: string;
  destination?: string;
  destinationIata?: string;
  price?: number;
  currency?: string;
  dateFrom?: string;
  dateTo?: string;
  durationHours?: number | null;
  stopCount?: number | null;
  comfortScore?: number | null;
  travelScore?: number | null;
  dealLabel?: 'great_deal' | 'good_value' | 'fair_price' | 'overpriced';
  dealPriority?: number | null;
  radarState?: 'radar_hot' | 'radar_watch' | 'radar_none';
  radarPriority?: number | null;
  viewItineraryId?: string;
}

export interface ItineraryGenerationSignals {
  travelScoreNorm: number;
  dealScoreNorm: number;
  radarScoreNorm: number;
  budgetFitScore: number;
  stopsFitScore: number;
  comfortFitScore: number;
}

export interface GeneratedItineraryCandidate {
  candidateId: string;
  itineraryType: GeneratedItineraryType;
  sourceIds: string[];
  viewItineraryId?: string;
  origin: string;
  destination: string;
  destinationIata: string;
  price: number;
  currency: string;
  dateFrom?: string;
  dateTo?: string;
  durationHours: number | null;
  stopCount: number | null;
  comfortScore: number | null;
  travelScore: number | null;
  dealLabel?: 'great_deal' | 'good_value' | 'fair_price' | 'overpriced';
  dealPriority: number | null;
  radarState?: 'radar_hot' | 'radar_watch' | 'radar_none';
  radarPriority: number | null;
  generationSignals: ItineraryGenerationSignals;
  rankingScore: number;
  rankingPriority: number;
  explanation: string;
}

