"""Database helpers for scraped match, team, and player rows."""

from pipeline.db import DB


def get_existing_match_ids(db: DB) -> set[int]:
    """Return Sofascore match IDs that already have player stats."""
    rows = db.query(
        """SELECT m.sofascore_id
           FROM matches m
           WHERE m.sofascore_id IS NOT NULL
             AND EXISTS (
                 SELECT 1 FROM match_player_stats mps
                 WHERE mps.match_id = m.id
             )"""
    )
    return {r["sofascore_id"] for r in rows}


def get_league_id(db: DB, fotmob_id: int) -> int | None:
    row = db.query_one("SELECT id FROM leagues WHERE fotmob_id = %s", (fotmob_id,))
    return row["id"] if row else None


def upsert_team(db: DB, name: str, sofascore_id: int, league_id: int) -> int:
    row = db.query_one("SELECT id FROM teams WHERE sofascore_id = %s", (sofascore_id,))
    if row:
        return row["id"]
    row = db.insert_returning(
        "INSERT INTO teams (name, sofascore_id, league_id) VALUES (%s, %s, %s) RETURNING id",
        (name, sofascore_id, league_id),
    )
    return row["id"]


def upsert_player(
    db: DB,
    name: str,
    sofascore_id: int,
    team_id: int,
    match_date: str,
) -> int:
    """
    Create or update a player with minimal data.

    Only updates current_team_id when this match is from the same date or newer
    than the player's last recorded match, so historical scrapes do not
    overwrite current team assignments.
    """
    row = db.query_one(
        "SELECT id FROM players WHERE sofascore_id = %s",
        (sofascore_id,),
    )
    if row:
        last_match = db.query_one(
            """SELECT MAX(m.date) as last_date
               FROM match_player_stats mps
               JOIN matches m ON m.id = mps.match_id
               WHERE mps.player_id = %s""",
            (row["id"],),
        )

        if not last_match or str(match_date) >= str(last_match["last_date"]):
            db.execute(
                "UPDATE players SET current_team_id = %s WHERE id = %s",
                (team_id, row["id"]),
            )
        return row["id"]

    row = db.insert_returning(
        "INSERT INTO players (name, sofascore_id, current_team_id) VALUES (%s, %s, %s) RETURNING id",
        (name, sofascore_id, team_id),
    )
    return row["id"]


def needs_profile_fetch(db: DB, player_id: int) -> bool:
    row = db.query_one(
        "SELECT position, nationality FROM players WHERE id = %s",
        (player_id,),
    )
    if not row:
        return True
    if not row["position"] or row["position"] in ("G", "D", "M", "F"):
        return True
    return not row["nationality"]
