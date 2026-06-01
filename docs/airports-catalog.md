# Airports Catalog Refresh

The app uses OurAirports as the source of truth for airport metadata:

```text
https://ourairports.com/data/
https://davidmegginson.github.io/ourairports-data/airports.csv
```

The production catalog is written to:

```text
data/ourairports/catalog.json
```

The refresh job downloads the OurAirports datasets, builds the useful IATA catalog, computes a checksum across the source CSV files, and writes the catalog only when the upstream data changed. This avoids depending on manually downloaded files such as `Downloads/airports (1).csv`.

## Schedule

Default schedule:

```env
OURAIRPORTS_REFRESH_CRON=30 3 1 * *
OURAIRPORTS_REFRESH_TIMEZONE=Europe/Rome
```

This runs once a month at 03:30 Europe/Rome on the first day of the month.

## Manual Run

```bash
npm run worker:ourairports-refresh
```

The worker records an immutable audit event with `type=ourairports_refresh` and logs whether the catalog was `updated` or `unchanged`.
