-- Checkpoint state for long-running historical league-season backfills.

CREATE TABLE IF NOT EXISTS public.historical_backfill_progress (
  id BIGSERIAL PRIMARY KEY,
  league_id INTEGER REFERENCES public.leagues(id),
  fotmob_league_id INTEGER NOT NULL,
  league_name TEXT NOT NULL,
  season TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  expected_matches INTEGER NOT NULL DEFAULT 0,
  existing_matches INTEGER NOT NULL DEFAULT 0,
  scraped_matches INTEGER NOT NULL DEFAULT 0,
  stats_matches INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT historical_backfill_progress_status_check
    CHECK (status IN ('pending', 'running', 'computing', 'complete', 'failed', 'skipped'))
);

CREATE UNIQUE INDEX IF NOT EXISTS historical_backfill_progress_league_season_key
  ON public.historical_backfill_progress (fotmob_league_id, season);

CREATE INDEX IF NOT EXISTS idx_historical_backfill_progress_status
  ON public.historical_backfill_progress (status, season, fotmob_league_id);
