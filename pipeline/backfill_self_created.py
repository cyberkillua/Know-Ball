"""
Backfill self_created_shots and self_created_goals from Understat match shot data.

For each match that has Understat coverage and has players with NULL self_created_shots,
fetches per-shot data and updates match_player_stats.

Run after scrape.py, before rate.py:

    python -m pipeline.backfill_self_created

Safe to re-run — only processes matches where self_created_shots IS NULL.
Skips leagues not covered by Understat (e.g. Championship).
"""

import argparse
import time

from pipeline.db import DB
from pipeline.logger import get_logger
from pipeline.leagues import CURRENT_SEASON
from pipeline.scrapers.understat import fetch_match_shots

log = get_logger("backfill_self_created")

SELF_CREATED_ACTIONS = {"Dribble", "IndividualPlay"}

REQUEST_DELAY = 3


def get_unprocessed_matches(
    db: DB,
    season: str | None = None,
    fotmob_id: int | None = None,
) -> list[dict]:
    """
    Return matches that have Understat coverage and at least one player
    with self_created_shots IS NULL in match_player_stats.
    """
    where = [
        "m.understat_id IS NOT NULL",
        "l.understat_slug IS NOT NULL",
        "mps.self_created_shots IS NULL",
    ]
    params: list = []
    if season:
        where.append("m.season = %s")
        params.append(season)
    if fotmob_id:
        where.append("l.fotmob_id = %s")
        params.append(fotmob_id)

    return db.query(
        f"""
        SELECT DISTINCT m.id AS match_id, m.understat_id
        FROM matches m
        JOIN match_player_stats mps ON mps.match_id = m.id
        JOIN leagues l ON l.id = m.league_id
        WHERE {' AND '.join(where)}
        ORDER BY m.id DESC
        """,
        tuple(params),
    )


def process_match(db: DB, match_db_id: int, understat_match_id: int) -> int:
    """
    Fetch shots for one match and update match_player_stats.
    Returns number of players updated.
    """
    try:
        shots = fetch_match_shots(understat_match_id)
    except Exception as e:
        log.error(f"Failed to fetch shots for understat match {understat_match_id}: {e}")
        return 0

    # Aggregate per understat player_id
    from collections import defaultdict
    counts: dict[int, dict] = defaultdict(lambda: {"self_created_shots": 0, "self_created_goals": 0})

    for shot in shots:
        understat_pid = shot.get("player_id")
        if not understat_pid:
            continue
        if shot.get("last_action") in SELF_CREATED_ACTIONS:
            counts[understat_pid]["self_created_shots"] += 1
            if shot.get("result") == "Goal":
                counts[understat_pid]["self_created_goals"] += 1

    if not counts:
        # Mark all players in this match as processed (0/0)
        db.execute(
            """
            UPDATE match_player_stats
            SET self_created_shots = 0, self_created_goals = 0
            WHERE match_id = %s AND self_created_shots IS NULL
            """,
            (match_db_id,),
        )
        return 0

    updated = 0
    for understat_pid, c in counts.items():
        result = db.execute(
            """
            UPDATE match_player_stats mps
            SET self_created_shots = %s,
                self_created_goals = %s
            FROM players p
            WHERE mps.player_id = p.id
              AND mps.match_id = %s
              AND p.understat_id = %s
            """,
            (c["self_created_shots"], c["self_created_goals"], match_db_id, understat_pid),
        )
        if result:
            updated += 1

    # Zero out any remaining players in this match who had no self-created shots
    db.execute(
        """
        UPDATE match_player_stats
        SET self_created_shots = 0, self_created_goals = 0
        WHERE match_id = %s AND self_created_shots IS NULL
        """,
        (match_db_id,),
    )

    return updated


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill self-created shot stats")
    parser.add_argument("--season", default=CURRENT_SEASON)
    parser.add_argument("--league", type=int, help="Optional FotMob league id")
    args = parser.parse_args()

    log.info("Starting self_created backfill")
    db = DB()

    matches = get_unprocessed_matches(db, season=args.season, fotmob_id=args.league)
    log.info(f"Found {len(matches)} matches to process")

    total_updated = 0
    for i, row in enumerate(matches, start=1):
        log.info(f"[{i}/{len(matches)}] match_id={row['match_id']} understat_id={row['understat_id']}")
        updated = process_match(db, row["match_id"], row["understat_id"])
        total_updated += updated
        time.sleep(REQUEST_DELAY)

    db.close()
    log.info(f"Done — updated {total_updated} player rows across {len(matches)} matches")


if __name__ == "__main__":
    main()
