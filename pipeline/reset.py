"""
Reset script — clears computed data so ratings can be regenerated from scratch.

Scraped data (match_player_stats, shots, matches, players, teams) is never
touched by a plain reset — only derived/computed tables are cleared.

Usage:
    python -m pipeline.reset                  # Clear match_ratings + peer_ratings (all leagues)
    python -m pipeline.reset --league 47      # Clear computed data for one league only
    python -m pipeline.reset --position CAM   # Clear match_ratings + peer_ratings for one position only
    python -m pipeline.reset --full           # Clear everything including scraped stats, matches, players, teams
"""

import argparse
from pipeline.db import DB
from pipeline.logger import get_logger

log = get_logger("reset")


def _get_position_bucket(pos: str) -> list[str]:
    """Return all positions that belong to the same bucket as the given position."""
    if pos in ("CM", "CDM", "DM"):
        return ["CM", "CDM", "DM"]
    if pos in ("CAM", "AM"):
        return ["CAM", "AM"]
    if pos in ("ST", "CF", "SS", "FW"):
        return ["ST", "CF", "SS", "FW"]
    if pos in ("LW", "RW", "LM", "RM", "W", "WINGER"):
        return ["LW", "RW", "LM", "RM"]
    if pos in ("CB", "LB", "RB", "LWB", "RWB", "DEF"):
        return ["CB", "LB", "RB", "LWB", "RWB"]
    if pos == "GK":
        return ["GK"]
    return [pos]


def main():
    parser = argparse.ArgumentParser(description="Reset Know Ball data")
    parser.add_argument(
        "--full",
        action="store_true",
        help="Clear all data (ratings, stats, matches, players, teams)",
    )
    parser.add_argument(
        "--league", type=int, help="Only clear data for a specific FotMob league ID"
    )
    parser.add_argument(
        "--position",
        type=str,
        help="Only clear match_ratings + peer_ratings for a specific position (e.g. CAM, W, ST)",
    )
    args = parser.parse_args()

    db = DB()

    if args.position:
        pos = args.position.upper()
        bucket = _get_position_bucket(pos)
        placeholders = ",".join(["%s"] * len(bucket))
        log.info(f"Clearing match_ratings + peer_ratings for position={pos} (bucket: {bucket})")
        db.execute(f"DELETE FROM match_ratings WHERE position IN ({placeholders})", bucket)
        log.info(f"  Cleared match_ratings ({bucket})")
        db.execute(f"DELETE FROM peer_ratings WHERE position IN ({placeholders})", bucket)
        log.info(f"  Cleared peer_ratings ({bucket})")
        db.close()
        log.info("Reset complete")
        return

    if args.league:
        # Get internal league ID
        row = db.query_one(
            "SELECT id, name FROM leagues WHERE fotmob_id = %s", (args.league,)
        )
        if not row:
            log.error(f"League with fotmob_id {args.league} not found")
            return
        lid = row["id"]
        lname = row["name"]

        if args.full:
            log.info(f"Full reset for {lname} (league_id={lid})")
            # Ratings for matches in this league
            db.execute(
                """
                DELETE FROM match_ratings WHERE match_id IN (SELECT id FROM matches WHERE league_id = %s)
            """,
                (lid,),
            )
            log.info("  Cleared match_ratings")
            # Player stats
            db.execute(
                """
                DELETE FROM match_player_stats WHERE match_id IN (SELECT id FROM matches WHERE league_id = %s)
            """,
                (lid,),
            )
            log.info("  Cleared match_player_stats")
            # Peer ratings
            db.execute("DELETE FROM peer_ratings WHERE league_id = %s", (lid,))
            log.info("  Cleared peer_ratings")
            # Matches
            db.execute("DELETE FROM matches WHERE league_id = %s", (lid,))
            log.info("  Cleared matches")
        else:
            log.info(f"Clearing computed data for {lname}")
            db.execute(
                """
                DELETE FROM match_ratings WHERE match_id IN (SELECT id FROM matches WHERE league_id = %s)
            """,
                (lid,),
            )
            log.info("  Cleared match_ratings")
            db.execute("DELETE FROM peer_ratings WHERE league_id = %s", (lid,))
            log.info("  Cleared peer_ratings")
    else:
        if args.full:
            log.info("Full reset — clearing ALL data")
            for table in [
                "match_ratings",
                "match_player_stats",
                "peer_ratings",
                "shots",
                "matches",
                "players",
                "teams",
            ]:
                db.execute(f"TRUNCATE {table} CASCADE")
                log.info(f"  Truncated {table}")
        else:
            log.info("Clearing all computed data (match_ratings + peer_ratings)")
            db.execute("DELETE FROM match_ratings")
            log.info("  Cleared match_ratings")
            db.execute("DELETE FROM peer_ratings")
            log.info("  Cleared peer_ratings")

    db.close()
    log.info("Reset complete")


if __name__ == "__main__":
    main()
