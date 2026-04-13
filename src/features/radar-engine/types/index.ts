export type RadarState = 'radar_hot' | 'radar_watch' | 'radar_none';

export type RadarDealLabel = 'great_deal' | 'good_value' | 'fair_price' | 'overpriced';

export interface RadarSignalInput {
  dealLabel?: unknown;
  dealPriority?: unknown;
  dealSignals?: unknown;
  travelScore?: unknown;
  savingVs2024?: unknown;
  savingPctVs2024?: unknown;
  price?: unknown;
  avg2024?: unknown;
}

export interface RadarSignals {
  dealLabel: RadarDealLabel | null;
  dealPriority: number | null;
  travelScore: number | null;
  savingVs2024: number | null;
  savingPctVs2024: number | null;
  price: number | null;
}

export interface RadarEvaluation {
  state: RadarState;
  priority: number;
  reason: string;
}

export interface RadarAnnotatedFields {
  radarState: RadarState;
  radarPriority: number;
  radarReason: string;
  radarSignals: RadarSignals;
}

