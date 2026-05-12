"""Database helpers for scraped match, team, and player rows."""

from pipeline.db import DB


_PLAYER_TEAM_STATE: dict[int, tuple[str | None, int | None]] = {}


def clear_player_team_state_cache() -> None:
    """Clear cached player latest-match/team state between independent runs."""
    _PLAYER_TEAM_STATE.clear()


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
        "SELECT id, current_team_id FROM players WHERE sofascore_id = %s",
        (sofascore_id,),
    )
    if row:
        player_id = row["id"]
        state = _PLAYER_TEAM_STATE.get(player_id)
        if state is None:
            last_match = db.query_one(
                """SELECT MAX(m.date) as last_date
                   FROM match_player_stats mps
                   JOIN matches m ON m.id = mps.match_id
                   WHERE mps.player_id = %s""",
                (player_id,),
            )
            state = (
                str(last_match["last_date"]) if last_match and last_match["last_date"] else None,
                row["current_team_id"],
            )
            _PLAYER_TEAM_STATE[player_id] = state

        last_date, current_team_id = state
        if (last_date is None or str(match_date) >= last_date) and current_team_id != team_id:
            db.execute(
                "UPDATE players SET current_team_id = %s WHERE id = %s",
                (team_id, player_id),
            )
            _PLAYER_TEAM_STATE[player_id] = (str(match_date), team_id)
        return player_id

    row = db.insert_returning(
        "INSERT INTO players (name, sofascore_id, current_team_id) VALUES (%s, %s, %s) RETURNING id",
        (name, sofascore_id, team_id),
    )
    _PLAYER_TEAM_STATE[row["id"]] = (str(match_date), team_id)
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
