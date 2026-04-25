"""Daily Know Ball pipeline orchestrator."""

import argparse
import os
import subprocess
import sys

from pipeline.logger import get_logger
from pipeline.scrape import CURRENT_SEASON

log = get_logger("daily")


def _run(module: str, *args: str) -> None:
    cmd = [sys.executable, "-m", module, *args]
    log.info("Running: " + " ".join(cmd))
    subprocess.run(cmd, check=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the daily Know Ball pipeline")
    parser.add_argument(
        "--season",
        default=os.getenv("CURRENT_SEASON") or CURRENT_SEASON,
        help="Season string, defaults to CURRENT_SEASON env or pipeline.scrape.CURRENT_SEASON",
    )
    parser.add_argument("--league", type=int, help="Optional FotMob league id")
    parser.add_argument("--season-stats-concurrency", type=int, default=8)
    parser.add_argument("--season-stats-batch-size", type=int, default=200)
    parser.add_argument("--skip-health-check", action="store_true")
    args = parser.parse_args()

    scoped: list[str] = ["--season", args.season]
    if args.league:
        scoped.extend(["--league", str(args.league)])

    _run("pipeline.scrape", *scoped)
    _run("pipeline.backfill_match_player_extras", *scoped)
    _run("pipeline.backfill_self_created", *scoped)
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
        _run("pipeline.health_check", "--season", args.season)


if __name__ == "__main__":
    main()
