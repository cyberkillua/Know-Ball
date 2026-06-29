# Pipeline Layout

The pipeline package is grouped by responsibility so active code is easier to
find and edit.

## Folders

- `core/` contains shared database, league, logging, query, and storage helpers.
- `ingest/` contains Sofascore/Understat scraping, active backfills, and scraper clients.
- `model/` contains match rating, season compute, reset/calibration, and the scoring engine.
- `jobs/` contains orchestration and operational checks.

## Main Commands

- `python -m pipeline.ingest.scrape`
- `python -m pipeline.model.rate`
- `python -m pipeline.model.compute`
- `python -m pipeline.jobs.daily`
- `python -m pipeline.jobs.historical_backfill`

## FIFA World Cup

The World Cup is an optional competition because its `2026` season label does
not match the domestic leagues' `2025/2026` label. After applying the database
migrations, scrape completed World Cup matches with:

```bash
python -m pipeline.ingest.scrape --league 77 --season 2026 --recent-days 7
```

If SofaScore returns HTTP `403`, the current public IP is blocked. Run from a
different network/VPN, or configure an HTTP/SOCKS proxy:

```bash
SOFASCORE_PROXY=http://user:password@proxy-host:port \
  python -m pipeline.ingest.scrape --league 77 --season 2026 --recent-days 7
```

Older one-off repair scripts were removed once their data migrations were no
longer part of the current workflow.
