export type DealValueLabel = 'great_deal' | 'good_value' | 'fair_price' | 'overpriced';

export interface DealSignalInput {
  price?: unknown;
  avg2024?: unknown;
  savingVs2024?: unknown;
  travelScore?: unknown;
}

export interface DealSignals {
  price: number | null;
  avg2024: number | null;
  savingVs2024: number | null;
  savingPctVs2024: number | null;
  travelScore: number | null;
}

export interface DealValueClassification {
  label: DealValueLabel;
  priority: number;
  reason: string;
}

export interface DealAnnotatedFields {
  dealLabel: DealValueLabel;
  dealPriority: number;
  dealReason: string;
  dealSignals: DealSignals;
}

