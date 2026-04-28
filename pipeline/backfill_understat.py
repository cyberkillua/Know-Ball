"""
Backfill xGChain / xGBuildup from Understat.

Automatically discovers all (league, season) pairs already in the DB
and fetches Understat stats for each — no hardcoded seasons.

Skips leagues Understat doesn't cover (e.g. Championship).

Run once after applying migration 018_understat_season_stats.sql:

    python -m pipeline.backfill_understat

Safe to re-run — all upserts use ON CONFLICT DO UPDATE.
"""

from pipeline.db import DB
from pipeline.leagues import LEAGUES
from pipeline.logger import get_logger
from pipeline.understat_sync import update_understat_stats

log = get_logger("backfill_understat")

# fotmob_id → understat_slug (None = not covered by Understat)
FOTMOB_TO_UNDERSTAT = {fotmob_id: slug for _, fotmob_id, slug in LEAGUES}


def main() -> None:
    db = DB()
    try:
        # Discover every (league, season) pair we have match data for
        rows = db.query(
            """
            SELECT DISTINCT l.fotmob_id, m.season
            FROM matches m
            JOIN leagues l ON l.id = m.league_id
            WHERE l.fotmob_id IS NOT NULL
            ORDER BY m.season DESC
            """
        )

        for row in rows:
            slug = FOTMOB_TO_UNDERSTAT.get(row["fotmob_id"])
            if not slug:
                # League not covered by Understat (e.g. Championship)
                continue
            season = row["season"]
            log.info(f"Backfilling {slug} {season}")
            try:
                update_understat_stats(db, slug, season)
            except Exception as e:
                log.error(f"Failed {slug} {season}: {e}")
                continue
    finally:
        db.close()

    log.info("Backfill complete")


if __name__ == "__main__":
    main()
