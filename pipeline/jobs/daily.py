"""Daily Know Ball pipeline orchestrator."""

import argparse
import os
import subprocess
import sys

from pipeline.core.db import DB
from pipeline.core.leagues import CURRENT_SEASON, LEAGUES
from pipeline.core.logger import get_logger
from pipeline.core.settings import SETTINGS

log = get_logger("daily")


def _run(module: str, *args: str) -> None:
    cmd = [sys.executable, "-m", module, *args]
    log.info("Running: " + " ".join(cmd))
    subprocess.run(cmd, check=True)


def _env_truthy(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int = 0) -> int:
    raw = os.getenv(name)
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        log.warning(f"Ignoring invalid integer env var {name}={raw!r}")
        return default


def _max_match_id(db: DB) -> int:
    row = db.query_one("SELECT COALESCE(MAX(id), 0)::int AS id FROM matches")
    return int(row["id"] or 0) if row else 0


def _changed_leagues_since(
    db: DB,
    *,
    season: str,
    min_match_id: int,
    fotmob_league_id: int | None,
) -> list[dict]:
    params: list = [season, min_match_id]
    league_filter = ""
    if fotmob_league_id:
        league_filter = "AND l.fotmob_id = %s"
        params.append(fotmob_league_id)

    return db.query(
        f"""
        SELECT
          l.id::int AS league_id,
          l.fotmob_id::int AS fotmob_id,
          l.name,
          COUNT(*)::int AS new_matches
        FROM matches m
        JOIN leagues l ON l.id = m.league_id
        WHERE m.season = %s
          AND m.id > %s
          AND m.home_score IS NOT NULL
          {league_filter}
        GROUP BY l.id, l.fotmob_id, l.name
        ORDER BY l.name
        """,
        tuple(params),
    )


def _configured_leagues(db: DB, fotmob_league_id: int | None) -> list[dict]:
    fotmob_ids = [fotmob_league_id] if fotmob_league_id else [league[1] for league in LEAGUES]
    rows = db.query(
        """
        SELECT id::int AS league_id, fotmob_id::int AS fotmob_id, name
        FROM leagues
        WHERE fotmob_id IN %s
        ORDER BY name
        """,
        (tuple(fotmob_ids),),
    )
    found = {row["fotmob_id"] for row in rows}
    missing = sorted(set(fotmob_ids) - found)
    if missing:
        log.warning(f"Configured FotMob league ids not found in DB: {missing}")
    return rows


def _run_league_pipeline(
    *,
    season: str,
    league_id: int,
    fotmob_id: int,
    full_backfills: bool,
    season_stats_concurrency: int,
    season_stats_batch_size: int,
) -> None:
    season_scope = ["--season", season]
    db_league_scope = [*season_scope, "--league", str(league_id)]
    fotmob_league_scope = [*season_scope, "--league", str(fotmob_id)]

    if full_backfills:
        _run("pipeline.ingest.backfill_match_player_extras", *db_league_scope)

    _run("pipeline.ingest.backfill_self_created", *fotmob_league_scope)

    if full_backfills:
        _run(
            "pipeline.ingest.backfill_player_season_sofascore",
            *fotmob_league_scope,
            "--concurrency",
            str(season_stats_concurrency),
            "--batch-size",
            str(season_stats_batch_size),
        )

    _run("pipeline.model.rate", *db_league_scope)
    _run("pipeline.model.compute", *db_league_scope)
    _run("pipeline.model.compute_teams", *db_league_scope)


def _refresh_planner_stats() -> None:
    """Refresh planner statistics after the bulk rating rewrites.

    rate/compute delete-and-reinsert match_ratings and peer_ratings, which leaves
    the planner's stats stale until autovacuum lazily catches up. Running ANALYZE
    here keeps the read app's query plans accurate against the freshly written data.
    """
    db = DB()
    try:
        log.info("Refreshing planner statistics (ANALYZE)")
        db.execute(
            "ANALYZE match_ratings, peer_ratings, match_player_stats, shots, "
            "team_style_profiles"
        )
    finally:
        db.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the daily Know Ball pipeline")
    parser.add_argument(
        "--season",
        default=CURRENT_SEASON,
        help="Season string; defaults to config/pipeline.toml current_season",
    )
    parser.add_argument("--league", type=int, help="Optional FotMob league id")
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
    parser.add_argument("--skip-health-check", action="store_true")
    parser.add_argument(
        "--recent-days",
        type=int,
        default=_env_int("KNOW_BALL_RECENT_DAYS", SETTINGS.daily.recent_days),
        help=(
            "Only scrape completed matches from the previous N day(s). "
            "Use 0 to reconcile finished matches from each configured league season."
        ),
    )
    parser.add_argument(
        "--full-backfills",
        action="store_true",
        default=_env_truthy("KNOW_BALL_FULL_BACKFILLS"),
        help=(
            "Run heavyweight full-season backfills after scraping. Daily runs "
            "leave this off and only scrape missing/incomplete matches."
        ),
    )
    parser.add_argument(
        "--skip-sofascore-ingest",
        action="store_true",
        default=_env_truthy("KNOW_BALL_SKIP_SOFASCORE_INGEST"),
        help=(
            "Skip Sofascore-backed scrape/backfill steps and only recompute "
            "from existing database rows."
        ),
    )
    parser.add_argument(
        "--force-recompute",
        action="store_true",
        default=_env_truthy("KNOW_BALL_FORCE_RECOMPUTE"),
        help=(
            "Run rating/compute for the selected configured leagues even if "
            "no new matches were inserted during this run."
        ),
    )
    args = parser.parse_args()

    season_scope: list[str] = ["--season", args.season]

    db = DB()
    before_match_id = _max_match_id(db)
    db.close()

    if args.skip_sofascore_ingest:
        log.warning(
            "Skipping Sofascore ingest steps. Run these from a trusted/local "
            "network or a self-hosted runner to refresh match and player data."
        )
    else:
        scrape_args = [*season_scope]
        if args.league:
            scrape_args.extend(["--league", str(args.league)])
        if args.recent_days > 0:
            scrape_args.extend(["--recent-days", str(args.recent_days)])

        _run("pipeline.ingest.scrape", *scrape_args)

    db = DB()
    try:
        changed_leagues = _changed_leagues_since(
            db,
            season=args.season,
            min_match_id=before_match_id,
            fotmob_league_id=args.league,
        )
        target_leagues = (
            _configured_leagues(db, args.league)
            if args.skip_sofascore_ingest or args.force_recompute
            else changed_leagues
        )
    finally:
        db.close()

    if not target_leagues:
        log.info("No new completed matches found; skipping rating and compute")
    else:
        for league in target_leagues:
            log.info(
                "Running scoped pipeline for "
                f"{league['name']} ({league.get('new_matches', 'forced')} new matches)"
            )
            _run_league_pipeline(
                season=args.season,
                league_id=int(league["league_id"]),
                fotmob_id=int(league["fotmob_id"]),
                full_backfills=args.full_backfills,
                season_stats_concurrency=args.season_stats_concurrency,
                season_stats_batch_size=args.season_stats_batch_size,
            )
        _refresh_planner_stats()

    if not args.skip_health_check:
        health_args = [*season_scope]
        if args.skip_sofascore_ingest or args.recent_days > 0:
            health_args.append("--no-strict")
        _run("pipeline.jobs.health_check", *health_args)


if __name__ == "__main__":
    main()
