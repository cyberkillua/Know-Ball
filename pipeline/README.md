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

Older one-off repair scripts were removed once their data migrations were no
longer part of the current workflow.
