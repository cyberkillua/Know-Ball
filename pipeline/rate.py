"""
Main rating entrypoint.

Calculates match ratings for all unrated player-match records.
Designed to run after scrape.py.
"""

from pipeline.db import DB
from pipeline.logger import get_logger
from pipeline.engine.config import load_position_config, get_available_positions
from pipeline.engine.calculator import PlayerMatchStats, calculate_match_rating

log = get_logger("rate")

MIN_MINUTES = 10


def get_unrated_records(db: DB) -> list[dict]:
    return db.query("""
        SELECT mps.*,
               mts.possession_pct  AS team_possession_pct,
               mts.total_shots     AS team_total_shots
        FROM match_player_stats mps
        LEFT JOIN match_ratings mr  ON mr.match_id  = mps.match_id AND mr.player_id  = mps.player_id
        LEFT JOIN match_team_stats mts ON mts.match_id = mps.match_id AND mts.team_id = mps.team_id
        WHERE mr.id IS NULL
          AND mps.minutes_played >= %s
    """, (MIN_MINUTES,))


def get_player_position(db: DB, player_id: int) -> str | None:
    row = db.query_one("SELECT position FROM players WHERE id = %s", (player_id,))
    return row["position"] if row else None


def _normalize_position(position: str) -> str:
    pos = position.upper().strip()
    # Specific lineup positions from FotMob (granular)
    # Only true centre-forwards / strikers map to ST
    if pos in {"ST", "CF"}:
        return "ST"
    # Wingers are NOT strikers — they'll get their own config later
    if pos in {"LW", "RW", "LM", "RM"}:
        return "WINGER"
    # Attacking midfielders
    if pos in {"CAM", "AM"}:
        return "MID"
    # Central midfielders
    if pos in {"CM", "CDM", "DM"}:
        return "MID"
    # Defenders
    if pos in {"CB", "LB", "RB", "LWB", "RWB"}:
        return "DEF"
    # Goalkeeper
    if pos in {"GK"}:
        return "GK"
    # FotMob numeric fallback (old data without lineup positions)
    # 3 = FW (broad category) — treat as ST for legacy data
    if pos == "3":
        return "ST"
    if pos == "0":
        return "GK"
    if pos == "1":
        return "DEF"
    if pos == "2":
        return "MID"
    # Generic fallbacks
    if pos in {"FW", "FORWARD", "STRIKER"}:
        return "ST"
    if pos in {"MIDFIELDER"}:
        return "MID"
    if pos in {"DEFENDER"}:
        return "DEF"
    if pos in {"GOALKEEPER"}:
        return "GK"
    return pos


def rate_record(db: DB, record: dict, configs: dict) -> bool:
    player_id = record["player_id"]
    match_id = record["match_id"]

    position = get_player_position(db, player_id)
    if not position:
        return False

    position_key = _normalize_position(position)
    if position_key not in configs:
        return False

    config = configs[position_key]

    stats = PlayerMatchStats(
        minutes_played=record.get("minutes_played") or 0,
        goals=record.get("goals") or 0,
        shots_total=record.get("shots_total") or 0,
        shots_on_target=record.get("shots_on_target") or 0,
        shots_off_target=record.get("shots_off_target") or 0,
        xg=float(record.get("xg") or 0),
        xgot=float(record.get("xgot") or 0),
        assists=record.get("assists") or 0,
        xa=float(record.get("xa") or 0),
        key_passes=record.get("key_passes") or 0,
        touches=record.get("touches") or 0,
        passes_total=record.get("passes_total") or 0,
        passes_completed=record.get("passes_completed") or 0,
        successful_dribbles=record.get("successful_dribbles") or 0,
        failed_dribbles=record.get("failed_dribbles") or 0,
        fouls_won=record.get("fouls_won") or 0,
        aerial_duels_won=record.get("aerial_duels_won") or 0,
        aerial_duels_lost=record.get("aerial_duels_lost") or 0,
        ground_duels_won=record.get("ground_duels_won") or 0,
        ground_duels_lost=record.get("ground_duels_lost") or 0,
        tackles_won=record.get("tackles_won") or 0,
        interceptions=record.get("interceptions") or 0,
        ball_recovery=record.get("ball_recovery") or 0,
        big_chance_missed=record.get("big_chance_missed") or 0,
        big_chance_created=record.get("big_chance_created") or 0,
        blocked_scoring_attempt=record.get("blocked_scoring_attempt") or 0,
        penalty_won=record.get("penalty_won") or 0,
        possession_lost_ctrl=record.get("possession_lost_ctrl") or 0,
        error_lead_to_goal=record.get("error_lead_to_goal") or 0,
        team_possession_pct=float(record.get("team_possession_pct") or 0),
        team_total_shots=record.get("team_total_shots") or 0,
    )

    final_rating, scores = calculate_match_rating(stats, config)

    db.execute(
        """INSERT INTO match_ratings
           (match_id, player_id, position,
            finishing_raw, involvement_raw, carrying_raw, physical_raw, pressing_raw,
            finishing_norm, involvement_norm, carrying_norm, physical_norm, pressing_norm,
            final_rating, sofascore_rating)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
           ON CONFLICT (match_id, player_id) DO NOTHING""",
        (match_id, player_id, position_key,
         scores.finishing_raw, scores.involvement_raw, scores.carrying_raw,
         scores.physical_raw, scores.pressing_raw,
         scores.finishing_norm, scores.involvement_norm, scores.carrying_norm,
         scores.physical_norm, scores.pressing_norm,
         final_rating, float(record.get("sofascore_rating") or 0)),
    )
    return True


def main():
    log.info("Starting Know Ball rating engine")
    db = DB()

    available = get_available_positions()
    configs = {}
    for pos in available:
        configs[pos] = load_position_config(pos)
    log.info(f"Loaded configs for positions: {available}")

    unrated = get_unrated_records(db)
    log.info(f"Found {len(unrated)} unrated player-match records")

    rated_count = 0
    skipped_count = 0

    for record in unrated:
        try:
            if rate_record(db, record, configs):
                rated_count += 1
            else:
                skipped_count += 1
        except Exception as e:
            log.error(f"Error rating player {record['player_id']} match {record['match_id']}: {e}")
            skipped_count += 1

    db.close()
    log.info(f"Rating complete: {rated_count} rated, {skipped_count} skipped")


if __name__ == "__main__":
    main()
