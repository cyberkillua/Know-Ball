"""Post-pipeline data health checks.

These checks are intentionally small and operational: they catch missing
backfills, unrated rows, and stale computed tables after a daily run.
"""

import argparse
import sys

from pipeline.db import DB
from pipeline.logger import get_logger
from pipeline.scrape import CURRENT_SEASON

log = get_logger("health_check")


def _count(db: DB, sql: str, params: tuple = ()) -> int:
    row = db.query_one(sql, params)
    return int(row["n"] or 0) if row else 0


def run_checks(season: str = CURRENT_SEASON, strict: bool = True) -> bool:
    db = DB()
    try:
        checks: list[tuple[str, bool, int]] = []

        checks.append(
            (
                "completed matches",
                _count(
                    db,
                    """
                    SELECT COUNT(*)::int AS n
                    FROM matches
                    WHERE season = %s AND home_score IS NOT NULL
                    """,
                    (season,),
                )
                > 0,
                0,
            )
        )
        checks.append(
            (
                "match player stats",
                _count(
                    db,
                    """
                    SELECT COUNT(*)::int AS n
                    FROM match_player_stats mps
                    JOIN matches m ON m.id = mps.match_id
                    WHERE m.season = %s
                    """,
                    (season,),
                )
                > 0,
                0,
            )
        )
        checks.append(
            (
                "Sofascore season stats",
                _count(
                    db,
                    """
                    SELECT COUNT(*)::int AS n
                    FROM player_season_sofascore
                    WHERE season = %s
                    """,
                    (season,),
                )
                > 0,
                0,
            )
        )
        checks.append(
            (
                "progressive carry distance rows",
                _count(
                    db,
                    """
                    SELECT COUNT(*)::int AS n
                    FROM match_player_stats mps
                    JOIN matches m ON m.id = mps.match_id
                    WHERE m.season = %s
                      AND COALESCE(mps.total_progressive_ball_carries_distance, 0) > 0
                    """,
                    (season,),
                )
                > 0,
                0,
            )
        )
        checks.append(
            (
                "pass value rows",
                _count(
                    db,
                    """
                    SELECT COUNT(*)::int AS n
                    FROM match_player_stats mps
                    JOIN matches m ON m.id = mps.match_id
                    WHERE m.season = %s
                      AND mps.pass_value_normalized IS NOT NULL
                    """,
                    (season,),
                )
                > 0,
                0,
            )
        )

        unrated = _count(
            db,
            """
            SELECT COUNT(*)::int AS n
            FROM match_player_stats mps
            JOIN matches m ON m.id = mps.match_id
            JOIN players p ON p.id = mps.player_id
            WHERE m.season = %s
              AND p.position IS NOT NULL
              AND mps.minutes_played >= 10
              AND NOT EXISTS (
                SELECT 1 FROM match_ratings mr
                WHERE mr.match_id = mps.match_id
                  AND mr.player_id = mps.player_id
              )
            """,
            (season,),
        )
        checks.append(("unrated eligible rows", unrated == 0, unrated))

        peer_rows = _count(
            db,
            """
            SELECT COUNT(*)::int AS n
            FROM peer_ratings
            WHERE season = %s
              AND peer_mode = 'dominant'
              AND position_scope = ''
            """,
            (season,),
        )
        checks.append(("peer ratings", peer_rows > 0, peer_rows))

        failed = False
        for name, ok, value in checks:
            if ok:
                log.info(f"OK: {name} ({value})")
            else:
                failed = True
                log.error(f"FAILED: {name} ({value})")

        if failed and strict:
            return False
        return True
    finally:
        db.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Run Know Ball data health checks")
    parser.add_argument("--season", default=CURRENT_SEASON)
    parser.add_argument("--no-strict", action="store_true", help="Log failures without exiting non-zero")
    args = parser.parse_args()

    ok = run_checks(season=args.season, strict=not args.no_strict)
    if not ok:
        sys.exit(1)


if __name__ == "__main__":
    main()
