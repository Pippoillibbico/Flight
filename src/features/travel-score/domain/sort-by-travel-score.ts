export function sortByTravelScore<T extends { travelScore: number; price?: number; savingVs2024?: number }>(itineraries: T[]): T[] {
  const list = [...(Array.isArray(itineraries) ? itineraries : [])];
  list.sort((a, b) => {
    const scoreDelta = Number(b.travelScore || 0) - Number(a.travelScore || 0);
    if (scoreDelta !== 0) return scoreDelta;
    const priceDelta = Number(a.price || 0) - Number(b.price || 0);
    if (priceDelta !== 0) return priceDelta;
    return Number(b.savingVs2024 || 0) - Number(a.savingVs2024 || 0);
  });
  return list;
}

export function sortItinerariesByTravelScore<T extends { travelScore: number; price?: number; savingVs2024?: number }>(
  itineraries: T[]
): T[] {
  return sortByTravelScore(itineraries);
}
