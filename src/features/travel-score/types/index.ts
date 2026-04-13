export interface TravelScoreItinerary {
  id?: string;
  price?: number;
  durationHours?: number;
  stopCount?: number;
  stops?: number;
}

export interface TravelScoreWeights {
  price: number;
  duration: number;
  stops: number;
}

export interface TravelScoreBounds {
  minPrice: number;
  maxPrice: number;
  minDurationHours: number;
  maxDurationHours: number;
  minStops: number;
  maxStops: number;
}

