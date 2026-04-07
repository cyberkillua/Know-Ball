"""
Backfill failed_dribbles in match_player_stats.

Historical scrapes incorrectly used `dispossessed` as failed dribbles.
Sofascore's live payloads show dribble attempts as:
  successful_dribbles = wonContest
  failed_dribbles     = totalContest - wonContest

Since we already persist `total_contest` and `successful_dribbles`, we can
repair historical rows locally without re-scraping.

Usage:
    python -m pipeline.backfill_failed_dribbles
    python -m pipeline.backfill_failed_dribbles --dry-run
"""

import argparse

from pipeline.db import DB
from pipeline.logger import get_logger

log = get_logger("backfill_failed_dribbles")


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill failed dribbles")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show how many rows would be updated without writing changes",
    )
    args = parser.parse_args()

    db = DB()

    rows = db.query(
        """
        SELECT COUNT(*)::int AS count
        FROM match_player_stats
        WHERE failed_dribbles IS DISTINCT FROM GREATEST(COALESCE(total_contest, 0) - COALESCE(successful_dribbles, 0), 0)
        """
    )
    to_update = rows[0]["count"] if rows else 0

    if args.dry_run:
        log.info(f"[dry-run] {to_update} rows would be updated")
        db.close()
        return

    db.execute(
        """
        UPDATE match_player_stats
        SET failed_dribbles = GREATEST(COALESCE(total_contest, 0) - COALESCE(successful_dribbles, 0), 0)
        WHERE failed_dribbles IS DISTINCT FROM GREATEST(COALESCE(total_contest, 0) - COALESCE(successful_dribbles, 0), 0)
        """
    )

    log.info(f"Updated {to_update} rows")
    db.close()


if __name__ == "__main__":
    main()
