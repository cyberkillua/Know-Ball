"""Understat linking and season-stat synchronization."""

from pipeline.db import DB
from pipeline.logger import get_logger
from pipeline.scrapers.understat import (
    fetch_league_matches as fetch_understat_matches,
    fetch_league_player_stats,
)

log = get_logger("understat_sync")


def _match_player_by_understat_id(db: DB, understat_id: int) -> int | None:
    row = db.query_one(
        "SELECT id FROM players WHERE understat_id = %s",
        (understat_id,),
    )
    return row["id"] if row else None


def _match_player_by_name(db: DB, name: str) -> int | None:
    row = db.query_one(
        "SELECT id FROM players WHERE LOWER(name) = LOWER(%s)",
        (name,),
    )
    return row["id"] if row else None


def backfill_understat_match_ids(
    db: DB,
    understat_slug: str,
    season: str,
    league_id: int,
) -> None:
    """
    Fetch Understat match list and link each match to its understat_id
    by matching on (league_id, date, home_score, away_score).
    """
    season_int = int(season.split("/")[0])
    try:
        understat_matches = fetch_understat_matches(understat_slug, season_int)
    except Exception as e:
        log.warning(
            f"Understat match list fetch failed for {understat_slug} {season_int}: {e}"
        )
        return

    for match in understat_matches:
        db.execute(
            """UPDATE matches
               SET understat_id = %s
               WHERE league_id = %s
                 AND date = %s
                 AND home_score = %s
                 AND away_score = %s
                 AND understat_id IS NULL""",
            (
                match["understat_id"],
                league_id,
                match["date"],
                match["home_score"],
                match["away_score"],
            ),
        )

    log.info(
        f"Linked understat IDs for up to {len(understat_matches)} matches "
        f"in {understat_slug} {season}"
    )


def update_understat_stats(db: DB, understat_slug: str, season: str) -> None:
    """
    Fetch Understat season stats for a league and upsert xGChain/xGBuildup.
    """
    if not understat_slug:
        return

    season_int = int(season.split("/")[0])
    try:
        players = fetch_league_player_stats(understat_slug, season_int)
    except Exception as e:
        log.error(f"Understat fetch failed for {understat_slug} {season_int}: {e}")
        return

    upserted = 0
    for player in players:
        player_id = _match_player_by_understat_id(db, player["understat_id"])
        if not player_id:
            player_id = _match_player_by_name(db, player["player_name"])
        if not player_id:
            continue

        db.execute(
            "UPDATE players SET understat_id = %s WHERE id = %s AND understat_id IS NULL",
            (player["understat_id"], player_id),
        )

        db.execute(
            """INSERT INTO player_season_understat
               (player_id, season, xg_chain, xg_buildup, xg_chain_per90,
                xg_buildup_per90, minutes_played, fetched_at)
               VALUES (%s, %s, %s, %s, %s, %s, %s, NOW())
               ON CONFLICT (player_id, season) DO UPDATE SET
                 xg_chain         = EXCLUDED.xg_chain,
                 xg_buildup       = EXCLUDED.xg_buildup,
                 xg_chain_per90   = EXCLUDED.xg_chain_per90,
                 xg_buildup_per90 = EXCLUDED.xg_buildup_per90,
                 minutes_played   = EXCLUDED.minutes_played,
                 fetched_at       = NOW()""",
            (
                player_id,
                season,
                player["xg_chain"],
                player["xg_buildup"],
                player["xg_chain_per90"],
                player["xg_buildup_per90"],
                player["minutes"],
            ),
        )
        upserted += 1

    log.info(f"Understat: upserted {upserted} records for {understat_slug} {season}")
