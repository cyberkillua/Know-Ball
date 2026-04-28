"""Daily Know Ball pipeline orchestrator."""

import argparse
import os
import subprocess
import sys

from pipeline.logger import get_logger
from pipeline.leagues import CURRENT_SEASON

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


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the daily Know Ball pipeline")
    parser.add_argument(
        "--season",
        default=os.getenv("CURRENT_SEASON") or CURRENT_SEASON,
        help="Season string, defaults to CURRENT_SEASON env or pipeline.leagues.CURRENT_SEASON",
    )
    parser.add_argument("--league", type=int, help="Optional FotMob league id")
    parser.add_argument("--season-stats-concurrency", type=int, default=8)
    parser.add_argument("--season-stats-batch-size", type=int, default=200)
    parser.add_argument("--skip-health-check", action="store_true")
    parser.add_argument(
        "--recent-days",
        type=int,
        default=_env_int("KNOW_BALL_RECENT_DAYS", 0),
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
    args = parser.parse_args()

    scoped: list[str] = ["--season", args.season]
    if args.league:
        scoped.extend(["--league", str(args.league)])

    if args.skip_sofascore_ingest:
        log.warning(
            "Skipping Sofascore ingest steps. Run these from a trusted/local "
            "network or a self-hosted runner to refresh match and player data."
        )
    else:
        scrape_args = [*scoped]
        if args.recent_days > 0:
            scrape_args.extend(["--recent-days", str(args.recent_days)])

        _run("pipeline.scrape", *scrape_args)

        if args.full_backfills:
            _run("pipeline.backfill_match_player_extras", *scoped)
        _run("pipeline.backfill_self_created", *scoped)
        if args.full_backfills:
            _run(
                "pipeline.backfill_player_season_sofascore",
                *scoped,
                "--concurrency",
                str(args.season_stats_concurrency),
                "--batch-size",
                str(args.season_stats_batch_size),
            )

    _run("pipeline.rate")
    _run("pipeline.compute")

    if not args.skip_health_check:
        health_args = ["--season", args.season]
        if args.skip_sofascore_ingest or args.recent_days > 0:
            health_args.append("--no-strict")
        _run("pipeline.health_check", *health_args)


if __name__ == "__main__":
    main()
