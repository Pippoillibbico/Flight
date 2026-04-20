const OPPORTUNITY_UPSERT_POSTGRES_SQL = `
  INSERT INTO travel_opportunities (
    id, observation_fingerprint, origin_city, origin_airport, destination_city, destination_airport,
    price, currency, depart_date, return_date, trip_length_days, trip_type, stops, airline,
    baggage_included, travel_duration_minutes, distance_km, airline_quality_score, booking_url,
    raw_score, final_score, opportunity_level, ai_title, ai_description, notification_text,
    why_it_matters, baseline_price, savings_percent_if_available, dedupe_key, is_published,
    published_at, enrichment_status, alert_status, source_observed_at, created_at, updated_at
  ) VALUES (
    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36
  )
  ON CONFLICT (observation_fingerprint) DO UPDATE SET
    origin_city = EXCLUDED.origin_city,
    origin_airport = EXCLUDED.origin_airport,
    destination_city = EXCLUDED.destination_city,
    destination_airport = EXCLUDED.destination_airport,
    price = EXCLUDED.price,
    currency = EXCLUDED.currency,
    depart_date = EXCLUDED.depart_date,
    return_date = EXCLUDED.return_date,
    trip_length_days = EXCLUDED.trip_length_days,
    trip_type = EXCLUDED.trip_type,
    stops = EXCLUDED.stops,
    airline = EXCLUDED.airline,
    baggage_included = EXCLUDED.baggage_included,
    travel_duration_minutes = EXCLUDED.travel_duration_minutes,
    distance_km = EXCLUDED.distance_km,
    airline_quality_score = EXCLUDED.airline_quality_score,
    booking_url = EXCLUDED.booking_url,
    raw_score = EXCLUDED.raw_score,
    final_score = EXCLUDED.final_score,
    opportunity_level = EXCLUDED.opportunity_level,
    ai_title = EXCLUDED.ai_title,
    ai_description = EXCLUDED.ai_description,
    notification_text = EXCLUDED.notification_text,
    why_it_matters = EXCLUDED.why_it_matters,
    baseline_price = EXCLUDED.baseline_price,
    savings_percent_if_available = EXCLUDED.savings_percent_if_available,
    dedupe_key = EXCLUDED.dedupe_key,
    is_published = EXCLUDED.is_published,
    published_at = EXCLUDED.published_at,
    enrichment_status = EXCLUDED.enrichment_status,
    alert_status = EXCLUDED.alert_status,
    source_observed_at = EXCLUDED.source_observed_at,
    updated_at = NOW()
`;

const OPPORTUNITY_UPSERT_SQLITE_SQL = `
  INSERT INTO travel_opportunities (
    id, observation_fingerprint, origin_city, origin_airport, destination_city, destination_airport,
    price, currency, depart_date, return_date, trip_length_days, trip_type, stops, airline,
    baggage_included, travel_duration_minutes, distance_km, airline_quality_score, booking_url,
    raw_score, final_score, opportunity_level, ai_title, ai_description, notification_text,
    why_it_matters, baseline_price, savings_percent_if_available, dedupe_key, is_published,
    published_at, enrichment_status, alert_status, source_observed_at, created_at, updated_at
  ) VALUES (
    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
    ?, ?, ?, ?, ?, ?
  )
  ON CONFLICT(observation_fingerprint) DO UPDATE SET
    origin_city=excluded.origin_city,
    origin_airport=excluded.origin_airport,
    destination_city=excluded.destination_city,
    destination_airport=excluded.destination_airport,
    price=excluded.price,
    currency=excluded.currency,
    depart_date=excluded.depart_date,
    return_date=excluded.return_date,
    trip_length_days=excluded.trip_length_days,
    trip_type=excluded.trip_type,
    stops=excluded.stops,
    airline=excluded.airline,
    baggage_included=excluded.baggage_included,
    travel_duration_minutes=excluded.travel_duration_minutes,
    distance_km=excluded.distance_km,
    airline_quality_score=excluded.airline_quality_score,
    booking_url=excluded.booking_url,
    raw_score=excluded.raw_score,
    final_score=excluded.final_score,
    opportunity_level=excluded.opportunity_level,
    ai_title=excluded.ai_title,
    ai_description=excluded.ai_description,
    notification_text=excluded.notification_text,
    why_it_matters=excluded.why_it_matters,
    baseline_price=excluded.baseline_price,
    savings_percent_if_available=excluded.savings_percent_if_available,
    dedupe_key=excluded.dedupe_key,
    is_published=excluded.is_published,
    published_at=excluded.published_at,
    enrichment_status=excluded.enrichment_status,
    alert_status=excluded.alert_status,
    source_observed_at=excluded.source_observed_at,
    updated_at=datetime('now')
`;

function buildOpportunityUpsertValues(row, { sqlite = false } = {}) {
  return [
    row.id,
    row.observation_fingerprint,
    row.origin_city,
    row.origin_airport,
    row.destination_city,
    row.destination_airport,
    row.price,
    row.currency,
    row.depart_date,
    row.return_date,
    row.trip_length_days,
    row.trip_type,
    row.stops,
    row.airline,
    sqlite ? (row.baggage_included == null ? null : row.baggage_included ? 1 : 0) : row.baggage_included,
    row.travel_duration_minutes,
    row.distance_km,
    row.airline_quality_score,
    row.booking_url,
    row.raw_score,
    row.final_score,
    row.opportunity_level,
    row.ai_title,
    row.ai_description,
    row.notification_text,
    row.why_it_matters,
    row.baseline_price,
    row.savings_percent_if_available,
    row.dedupe_key,
    sqlite ? (row.is_published ? 1 : 0) : row.is_published,
    row.published_at,
    row.enrichment_status,
    row.alert_status,
    row.source_observed_at,
    row.created_at,
    row.updated_at
  ];
}

export {
  OPPORTUNITY_UPSERT_POSTGRES_SQL,
  OPPORTUNITY_UPSERT_SQLITE_SQL,
  buildOpportunityUpsertValues
};
