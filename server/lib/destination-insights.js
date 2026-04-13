import { addDays, format } from 'date-fns';

export function buildDestinationInsights(params, { searchFlights }) {
  const horizonDays = Number.isFinite(params.horizonDays) ? params.horizonDays : 120;
  const windows = [];

  for (let offset = 1; offset <= horizonDays; offset += 1) {
    const from = addDays(new Date(), offset);
    const to = addDays(from, params.stayDays);
    const dateFrom = format(from, 'yyyy-MM-dd');
    const dateTo = format(to, 'yyyy-MM-dd');

    const result = searchFlights({
      origin: params.origin,
      region: params.region,
      country: params.country,
      destinationQuery: params.destinationQuery,
      dateFrom,
      dateTo,
      cheapOnly: params.cheapOnly,
      maxBudget: params.maxBudget,
      connectionType: params.connectionType,
      maxStops: params.maxStops,
      travelTime: params.travelTime,
      minComfortScore: params.minComfortScore,
      travellers: params.travellers,
      cabinClass: params.cabinClass
    });

    let flights = result.flights;
    if (params.destinationIata) {
      flights = flights.filter((flight) => flight.destinationIata === params.destinationIata);
    }

    const best = flights[0];
    if (!best) continue;

    windows.push({
      dateFrom,
      dateTo,
      origin: best.origin,
      destination: best.destination,
      destinationIata: best.destinationIata,
      price: best.price,
      avg2024: best.avg2024,
      highSeasonAvg: best.highSeasonAvg,
      savingVs2024: best.savingVs2024,
      link: best.link
    });
  }

  windows.sort((a, b) => a.price - b.price || b.savingVs2024 - a.savingVs2024);

  const top = windows.slice(0, 12);
  const prices = top.map((item) => item.price);
  const stats = {
    count: top.length,
    minPrice: prices.length ? Math.min(...prices) : null,
    maxPrice: prices.length ? Math.max(...prices) : null,
    avgPrice: prices.length ? Math.round(prices.reduce((acc, value) => acc + value, 0) / prices.length) : null
  };

  return { stats, windows: top };
}
