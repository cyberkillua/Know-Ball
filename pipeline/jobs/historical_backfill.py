"""Resumable historical league-season backfill orchestrator.

Examples:
    python -m pipeline.jobs.historical_backfill --years 10 --dry-run
    python -m pipeline.jobs.historical_backfill --years 10
    python -m pipeline.jobs.historical_backfill --league 47 --years 10
    python -m pipeline.jobs.historical_backfill --status
"""

from __future__ import annotations

import argparse
import subprocess
import sys
import traceback
from dataclasses import dataclass
from datetime import datetime

from pipeline.core.db import DB
from pipeline.core.leagues import CURRENT_SEASON, LEAGUES
from pipeline.core.logger import get_logger
from pipeline.core.settings import SETTINGS
from pipeline.ingest.scrape import clear_player_cache, get_existing_match_ids, get_league_id, scrape_league
from pipeline.ingest.scrapers.sofascore import fetch_league_matches
from pipeline.core.store import clear_player_team_state_cache

log = get_logger("historical_backfill")


@dataclass(frozen=True)
class LeagueSeason:
    league_name: str
    fotmob_id: int
    understat_slug: str | None
    season: str


def season_start_year(season: str) -> int:
    return int(season.split("/")[0])


def season_label(start_year: int) -> str:
    return f"{start_year}/{start_year + 1}"


def generate_seasons(*, years: int, end_season: str, oldest_first: bool) -> list[str]:
    end_year = season_start_year(end_season)
    seasons = [season_label(year) for year in range(end_year - years + 1, end_year + 1)]
    return seasons if oldest_first else list(reversed(seasons))


def selected_leagues(fotmob_id: int | None) -> list[tuple[str, int, str | None]]:
    if fotmob_id is None:
        return LEAGUES
    leagues = [league for league in LEAGUES if league[1] == fotmob_id]
    if not leagues:
        available = ", ".join(f"{name}={fid}" for name, fid, _ in LEAGUES)
        raise SystemExit(f"Unknown league id {fotmob_id}. Available: {available}")
    return leagues


def ensure_progress_table(db: DB) -> None:
    db.execute(
        """
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
        )
        """
    )
    db.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS historical_backfill_progress_league_season_key
          ON public.historical_backfill_progress (fotmob_league_id, season)
        """
    )
    db.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_historical_backfill_progress_status
          ON public.historical_backfill_progress (status, season, fotmob_league_id)
        """
    )


def progress_row(db: DB, job: LeagueSeason) -> dict | None:
    return db.query_one(
        """
        SELECT *
        FROM historical_backfill_progress
        WHERE fotmob_league_id = %s AND season = %s
        """,
        (job.fotmob_id, job.season),
    )


def upsert_progress(
    db: DB,
    job: LeagueSeason,
    *,
    league_id: int | None,
    status: str,
    expected_matches: int = 0,
    existing_matches: int = 0,
    scraped_matches: int = 0,
    stats_matches: int = 0,
    last_error: str | None = None,
    increment_attempts: bool = False,
    completed: bool = False,
) -> None:
    db.execute(
        """
        INSERT INTO historical_backfill_progress (
          league_id, fotmob_league_id, league_name, season, status,
          expected_matches, existing_matches, scraped_matches, stats_matches,
          attempts, last_error, started_at, completed_at, updated_at
        )
        VALUES (
          %s, %s, %s, %s, %s,
          %s, %s, %s, %s,
          %s, %s, CASE WHEN %s THEN NOW() ELSE NULL END,
          CASE WHEN %s THEN NOW() ELSE NULL END, NOW()
        )
        ON CONFLICT (fotmob_league_id, season) DO UPDATE SET
          league_id = EXCLUDED.league_id,
          league_name = EXCLUDED.league_name,
          status = EXCLUDED.status,
          expected_matches = EXCLUDED.expected_matches,
          existing_matches = EXCLUDED.existing_matches,
          scraped_matches = EXCLUDED.scraped_matches,
          stats_matches = EXCLUDED.stats_matches,
          attempts = historical_backfill_progress.attempts + CASE WHEN %s THEN 1 ELSE 0 END,
          last_error = EXCLUDED.last_error,
          started_at = CASE
            WHEN %s THEN NOW()
            ELSE historical_backfill_progress.started_at
          END,
          completed_at = CASE
            WHEN %s THEN NOW()
            ELSE historical_backfill_progress.completed_at
          END,
          updated_at = NOW()
        """,
        (
            league_id,
            job.fotmob_id,
            job.league_name,
            job.season,
            status,
            expected_matches,
            existing_matches,
            scraped_matches,
            stats_matches,
            1 if increment_attempts else 0,
            last_error,
            increment_attempts,
            completed,
            increment_attempts,
            increment_attempts,
            completed,
        ),
    )


def stored_match_counts(db: DB, league_id: int, season: str) -> tuple[int, int]:
    row = db.query_one(
        """
        SELECT
          COUNT(DISTINCT m.id)::int AS matches,
          COUNT(DISTINCT m.id) FILTER (WHERE mps.match_id IS NOT NULL)::int AS stats_matches
        FROM matches m
        LEFT JOIN match_player_stats mps ON mps.match_id = m.id
        WHERE m.league_id = %s
          AND m.season = %s
          AND m.home_score IS NOT NULL
        """,
        (league_id, season),
    )
    return int(row["matches"] or 0), int(row["stats_matches"] or 0)


def run_module(module: str, *args: str) -> None:
    cmd = [sys.executable, "-m", module, *args]
    log.info("Running: " + " ".join(cmd))
    subprocess.run(cmd, check=True)


def run_downstream(
    *,
    season: str,
    fotmob_id: int,
    full_backfills: bool,
    skip_self_created: bool,
    skip_health_check: bool,
    season_stats_concurrency: int,
    season_stats_batch_size: int,
) -> None:
    scoped = ["--season", season, "--league", str(fotmob_id)]
    if not skip_self_created:
        run_module("pipeline.ingest.backfill_self_created", *scoped)
    if full_backfills:
        run_module(
            "pipeline.ingest.backfill_player_season_sofascore",
            *scoped,
            "--concurrency",
            str(season_stats_concurrency),
            "--batch-size",
            str(season_stats_batch_size),
        )
    run_module("pipeline.model.rate", "--season", season, "--fotmob-league-id", str(fotmob_id))
    run_module("pipeline.model.compute", "--season", season, "--fotmob-league-id", str(fotmob_id))
    if not skip_health_check:
        run_module("pipeline.jobs.health_check", "--season", season, "--no-strict")


def job_plan(
    *,
    leagues: list[tuple[str, int, str | None]],
    seasons: list[str],
) -> list[LeagueSeason]:
    return [
        LeagueSeason(league_name, fotmob_id, understat_slug, season)
        for season in seasons
        for league_name, fotmob_id, understat_slug in leagues
    ]


def print_status(db: DB) -> None:
    ensure_progress_table(db)
    rows = db.query(
        """
        SELECT season, league_name, status, expected_matches, existing_matches,
               scraped_matches, stats_matches, attempts, updated_at, last_error
        FROM historical_backfill_progress
        ORDER BY season DESC, league_name
        """
    )
    if not rows:
        print("No historical backfill progress rows yet.")
        return
    for row in rows:
        print(
            f"{row['season']} | {row['league_name']:<18} | {row['status']:<9} | "
            f"matches {row['existing_matches']}/{row['expected_matches']} | "
            f"stats {row['stats_matches']} | attempts {row['attempts']}"
        )
        if row.get("last_error"):
            print(f"  error: {row['last_error'][:240]}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Resumable 10-year historical backfill")
    parser.add_argument("--years", type=int, default=10, help="Number of seasons including end season")
    parser.add_argument("--end-season", default=CURRENT_SEASON, help="Newest season, e.g. 2025/2026")
    parser.add_argument("--season", action="append", help="Specific season(s) to run; repeatable")
    parser.add_argument("--league", type=int, help="FotMob league id")
    parser.add_argument("--oldest-first", action="store_true", help="Run oldest seasons first")
    parser.add_argument("--force", action="store_true", help="Re-run even if checkpoint says complete")
    parser.add_argument("--dry-run", action="store_true", help="Print planned jobs and skip reasons")
    parser.add_argument("--status", action="store_true", help="Print checkpoint status and exit")
    parser.add_argument("--limit", type=int, help="Limit number of league-season jobs this run")
    parser.add_argument("--skip-compute", action="store_true", help="Scrape/checkpoint only; do not rate/compute")
    parser.add_argument("--skip-self-created", action="store_true", help="Skip Understat self-created backfill")
    parser.add_argument("--skip-health-check", action="store_true", help="Skip health check after compute")
    parser.add_argument("--full-backfills", action="store_true", help="Run heavyweight player-season Sofascore backfill")
    parser.add_argument(
        "--season-stats-concurrency",
        type=int,
        default=SETTINGS.daily.season_stats_concurrency,
    )
    parser.add_argument(
        "--season-stats-batch-size",
        type=int,
        default=SETTINGS.daily.season_stats_batch_size,
    )
    args = parser.parse_args()

    started = datetime.now().isoformat(timespec="seconds")
    log.info(f"Historical backfill runner started at {started}")

    leagues = selected_leagues(args.league)
    seasons = args.season or generate_seasons(
        years=args.years,
        end_season=args.end_season,
        oldest_first=args.oldest_first,
    )
    jobs = job_plan(leagues=leagues, seasons=seasons)
    if args.limit:
        jobs = jobs[: args.limit]

    db = DB()
    ensure_progress_table(db)

    if args.status:
        print_status(db)
        db.close()
        return

    lock = db.query_one("SELECT pg_try_advisory_lock(804202601)::bool AS locked")
    if not lock or not lock["locked"]:
        db.close()
        raise SystemExit("Another historical backfill runner appears to be active.")

    try:
        existing_ids = get_existing_match_ids(db)
        log.info(f"Historical backfill plan: {len(jobs)} league-season jobs")
        clear_player_cache()
        clear_player_team_state_cache()

        for idx, job in enumerate(jobs, start=1):
            league_id = get_league_id(db, job.fotmob_id)
            if not league_id:
                log.error(f"[{idx}/{len(jobs)}] League not found in DB: {job.league_name}")
                continue

            row = progress_row(db, job)
            if row and row["status"] == "complete" and not args.force:
                log.info(f"[{idx}/{len(jobs)}] Skip checkpoint complete: {job.league_name} {job.season}")
                continue

            log.info(f"[{idx}/{len(jobs)}] Inspecting {job.league_name} {job.season}")
            try:
                matches = fetch_league_matches(job.fotmob_id, job.season)
                expected = len(matches)
                existing_count, stats_count = stored_match_counts(db, league_id, job.season)
                already_complete = expected > 0 and existing_count >= expected and stats_count >= max(1, int(expected * 0.9))

                if args.dry_run:
                    if expected == 0:
                        state = "no completed matches returned"
                    elif already_complete and not args.force:
                        state = "already complete"
                    else:
                        state = "would scrape"
                    log.info(
                        f"[dry-run] {job.league_name} {job.season}: {state}; "
                        f"{existing_count}/{expected} matches stored, {stats_count} with stats"
                    )
                    continue

                if expected == 0:
                    log.warning(f"No completed matches available for {job.league_name} {job.season}; marking skipped")
                    upsert_progress(
                        db,
                        job,
                        league_id=league_id,
                        status="skipped",
                        expected_matches=0,
                        existing_matches=existing_count,
                        stats_matches=stats_count,
                        last_error="No completed matches returned by Sofascore",
                        completed=True,
                    )
                    continue

                if already_complete and not args.force:
                    log.info(
                        f"[{idx}/{len(jobs)}] Already complete in DB: "
                        f"{job.league_name} {job.season} ({existing_count}/{expected})"
                    )
                    upsert_progress(
                        db,
                        job,
                        league_id=league_id,
                        status="complete",
                        expected_matches=expected,
                        existing_matches=existing_count,
                        stats_matches=stats_count,
                        completed=True,
                    )
                    continue

                upsert_progress(
                    db,
                    job,
                    league_id=league_id,
                    status="running",
                    expected_matches=expected,
                    existing_matches=existing_count,
                    stats_matches=stats_count,
                    increment_attempts=True,
                )

                before_count, _ = stored_match_counts(db, league_id, job.season)
                summary = scrape_league(
                    db,
                    job.league_name,
                    job.fotmob_id,
                    job.understat_slug,
                    job.season,
                    existing_ids,
                    matches=matches,
                )
                existing_ids = get_existing_match_ids(db)
                after_count, after_stats = stored_match_counts(db, league_id, job.season)
                scraped_count = max(0, after_count - before_count)

                upsert_progress(
                    db,
                    job,
                    league_id=league_id,
                    status="computing" if not args.skip_compute else "complete",
                    expected_matches=expected,
                    existing_matches=after_count,
                    scraped_matches=scraped_count,
                    stats_matches=after_stats,
                    completed=args.skip_compute,
                )

                if not args.skip_compute:
                    run_downstream(
                        season=job.season,
                        fotmob_id=job.fotmob_id,
                        full_backfills=args.full_backfills,
                        skip_self_created=args.skip_self_created,
                        skip_health_check=args.skip_health_check,
                        season_stats_concurrency=args.season_stats_concurrency,
                        season_stats_batch_size=args.season_stats_batch_size,
                    )

                final_count, final_stats = stored_match_counts(db, league_id, job.season)
                upsert_progress(
                    db,
                    job,
                    league_id=league_id,
                    status="complete",
                    expected_matches=expected,
                    existing_matches=final_count,
                    scraped_matches=scraped_count or int(summary.get("new", 0)),
                    stats_matches=final_stats,
                    completed=True,
                )
                clear_player_cache()
                clear_player_team_state_cache()
            except KeyboardInterrupt:
                upsert_progress(
                    db,
                    job,
                    league_id=league_id,
                    status="failed",
                    last_error="Interrupted by user",
                )
                raise
            except Exception as e:
                error = f"{type(e).__name__}: {e}"
                log.error(f"Failed {job.league_name} {job.season}: {error}")
                log.debug(traceback.format_exc())
                existing_count, stats_count = stored_match_counts(db, league_id, job.season)
                upsert_progress(
                    db,
                    job,
                    league_id=league_id,
                    status="failed",
                    existing_matches=existing_count,
                    stats_matches=stats_count,
                    last_error=error,
                )
                continue
    finally:
        try:
            db.query_one("SELECT pg_advisory_unlock(804202601)")
        finally:
            db.close()


if __name__ == "__main__":
    main()
