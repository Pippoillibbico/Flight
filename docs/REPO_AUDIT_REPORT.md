# Repo Audit Report

Date: 2026-03-04

## 1) Architettura attuale
- Server entrypoint: `server/index.js`
- Frontend entrypoint: `src/main.jsx` (Vite/React)
- Router API principali:
  - core auth/search/watchlist/alerts in `server/index.js`
  - `server/routes/free-foundation.js`
  - `server/routes/deal-engine.js`
  - `server/routes/discovery.js`
  - `server/routes/apikeys.js`, `server/routes/billing.js`, `server/routes/usage.js`
- Middleware:
  - `server/middleware/request-id.js`
  - `server/middleware/error-handler.js`
  - `server/middleware/quotaGuard.js`
- Data layer:
  - local JSON DB via `server/lib/db.js`
  - SQL/PG layer via `server/lib/sql-db.js`, `server/lib/saas-db.js`
  - local price history/deal store via `server/lib/price-history-store.js`, `server/lib/deal-engine-store.js`
- Jobs/Cron:
  - free precompute: `server/jobs/free-precompute.js`
  - free alerts worker: `server/jobs/free-alert-worker.js`
  - route baseline recompute: `server/jobs/route-baselines.js`
  - discovery alert worker: `server/jobs/discovery-alert-worker.js`
  - ingestion worker: `server/lib/price-ingestion-worker.js` (schedulato da `server/index.js`)

## 2) Moduli deal engine (wired vs dead)
- Wired:
  - `baseline-price-engine.js`
  - `price-ingestion-worker.js`
  - `deal-detector.js`
  - `deal-ranking-engine.js`
  - `destination-discovery-engine.js`
  - `alert-intelligence.js`
  - `seasonal-context-engine.js`
  - `window-finder-engine.js`
  - `anomaly-detector.js`
  - `price-predictor.js`
- Endpoint wiring engine v2:
  - `GET /api/engine/status`
  - `POST /api/engine/recompute`
  - `POST /api/engine/windows`
  - `POST /api/engine/deals`
  - `POST /api/alerts/simulate`

## 3) Verifica provider esterni flight
- Runtime scan HTTP outbound: presenti chiamate verso OpenAI/Anthropic/OAuth; nessuna chiamata runtime a Skyscanner/Google Flights/Amadeus/Kiwi/Duffel.
- Provider registry (`server/lib/flight-provider.js`): default locale/proprietario `tde_booking`; implementazioni partner esterni non attive.

## 4) Gap sicurezza trovati e fix applicati
- Error handling unificato su `server/middleware/error-handler.js` con codici stabili.
- Request id middleware applicato early, con `X-Request-Id`.
- CORS allowlist + preflight OPTIONS + no wildcard con credentials.
- CSRF su flussi cookie auth e refresh protetto da origin + token.
- Rate limiters con payload machine-friendly e messaggi umani.
- Security logging centralizzato per 401/403/429 e altri eventi auth.
- Graceful shutdown SIGINT/SIGTERM con close server + pg pool.
- Health endpoint con `version` + `uptimeSeconds` + stato security key HMAC audit.

## 5) Rischi residui
- Alcune porzioni i18n legacy contengono testo con encoding storico non uniforme (non blocca runtime ma andrebbe ripulito).
- Permane complessita elevata in `server/index.js` (consigliata estrazione progressiva in moduli per ridurre blast radius).

## 6) Comandi di verifica usati
- Provider usage: `rg -n "skyscanner|google flights|amadeus|kiwi|duffel|rapidapi|serp|scrape" server src`
- Outbound HTTP: `rg -n "fetch\\(" server`
- Test unitari: `npm test`
- Build: `npm run build`
