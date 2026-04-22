"""
Main rating entrypoint.

Calculates match ratings for all unrated player-match records.
Designed to run after scrape.py.
"""

from pipeline.db import DB
from pipeline.logger import get_logger
from pipeline.engine.config import load_position_config, get_available_positions
from pipeline.engine.calculator import PlayerMatchStats, calculate_match_rating
from pipeline.engine.w_calculator import calculate_winger_rating, W_CATEGORIES
from pipeline.engine.cam_calculator import calculate_cam_rating, CAM_CATEGORIES
from pipeline.engine.cm_calculator import calculate_cm_rating, CM_CATEGORIES

log = get_logger("rate")

MIN_MINUTES = 10
BATCH_SIZE = 1000


def get_unrated_records_batch(db: DB, last_id: int, batch_size: int) -> list[dict]:
    return db.query(
        """
        SELECT mps.id,
               mps.match_id,
               mps.player_id,
               mps.minutes_played,
               mps.goals,
               mps.penalty_goals,
               mps.shots_total,
               mps.shots_on_target,
               mps.shots_off_target,
               mps.xg,
               mps.xgot,
               mps.assists,
               mps.xa,
               mps.key_passes,
               mps.touches,
               mps.passes_total,
               mps.passes_completed,
               mps.successful_dribbles,
               mps.failed_dribbles,
               mps.fouls_won,
               mps.aerial_duels_won,
               mps.aerial_duels_lost,
               mps.ground_duels_won,
               mps.ground_duels_lost,
               mps.tackles_won,
               mps.interceptions,
               mps.ball_recovery,
               mps.self_created_shots,
               mps.big_chance_missed,
               mps.big_chance_created,
               mps.blocked_scoring_attempt,
               mps.penalty_won,
               mps.possession_lost_ctrl,
               mps.error_lead_to_goal,
               mps.sofascore_rating,
               mts.possession_pct  AS team_possession_pct,
               mts.total_shots     AS team_total_shots,
               p.position AS player_position
        FROM match_player_stats mps
        JOIN players p ON p.id = mps.player_id
        LEFT JOIN match_team_stats mts ON mts.match_id = mps.match_id AND mts.team_id = mps.team_id
        WHERE mps.id > %s
          AND p.position IS NOT NULL
          AND mps.minutes_played >= %s
          AND NOT EXISTS (
              SELECT 1
              FROM match_ratings mr
              WHERE mr.match_id = mps.match_id
                AND mr.player_id = mps.player_id
          )
        ORDER BY mps.id
        LIMIT %s
    """,
        (last_id, MIN_MINUTES, batch_size),
    )


def _normalize_position(position: str) -> str:
    pos = position.upper().strip()
    # Specific lineup positions from FotMob (granular)
    # Only true centre-forwards / strikers map to ST
    if pos in {"ST", "CF", "SS"}:
        return "ST"
    if pos in {"LW", "RW", "LM", "RM"}:
        return "W"
    # Attacking midfielders
    if pos in {"CAM", "AM"}:
        return "CAM"
    # Central midfielders — both box-to-box CMs and defensive mids use the CM config
    if pos in {"CM", "CDM", "DM"}:
        return "CM"
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
        return "CM"
    # Broad Sofascore profile categories (single-letter)
    if pos == "F":
        return "ST"
    if pos == "M":
        return "CM"
    if pos == "D":
        return "DEF"
    if pos == "G":
        return "GK"
    # Generic fallbacks
    if pos in {"FW", "FORWARD", "STRIKER"}:
        return "ST"
    if pos in {"MIDFIELDER"}:
        return "CM"
    if pos in {"DEFENDER"}:
        return "DEF"
    if pos in {"GOALKEEPER"}:
        return "GK"
    return pos


def get_finishing_scores_batch(
    db: DB, records: list[dict]
) -> dict[tuple[int, int], float]:
    """Query shots table to compute per-shot finishing_score for a batch."""
    match_ids = list({r["match_id"] for r in records})
    if not match_ids:
        return {}

    rows = db.query(
        """
        WITH ranked AS (
            SELECT match_id, player_id, xg, result, situation, source,
                   ROW_NUMBER() OVER (
                       PARTITION BY match_id, player_id, minute
                       ORDER BY CASE WHEN source = 'sofascore' THEN 0 ELSE 1 END
                   ) AS rn
            FROM shots
            WHERE match_id = ANY(%s)
              AND situation IS DISTINCT FROM 'penalty'
        )
        SELECT match_id, player_id,
               SUM(CASE WHEN result = 'Goal' THEN 1 ELSE 0 END - COALESCE(xg, 0)) AS finishing_score
        FROM ranked
        WHERE rn = 1
        GROUP BY match_id, player_id
    """,
        (match_ids,),
    )

    return {(r["match_id"], r["player_id"]): float(r["finishing_score"]) for r in rows}


def rate_record(
    record: dict, configs: dict, finishing_scores: dict[tuple[int, int], float]
) -> tuple[bool, tuple | None]:
    player_id = record["player_id"]
    match_id = record["match_id"]

    position = record.get("player_position")
    if not position:
        log.debug(
            f"Skipped player {player_id} match {match_id}: no position"
        )
        return False, None

    position_key = _normalize_position(position)
    if position_key not in configs:
        log.warning(
            f"Skipped player {player_id} match {match_id}: "
            f"position '{position}' -> '{position_key}' has no config"
        )
        return False, None

    config = configs[position_key]

    stats = PlayerMatchStats(
        minutes_played=record.get("minutes_played") or 0,
        goals=record.get("goals") or 0,
        penalty_goals=record.get("penalty_goals") or 0,
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
        self_created_shots=record.get("self_created_shots") or 0,
        big_chance_missed=record.get("big_chance_missed") or 0,
        big_chance_created=record.get("big_chance_created") or 0,
        blocked_scoring_attempt=record.get("blocked_scoring_attempt") or 0,
        penalty_won=record.get("penalty_won") or 0,
        possession_lost_ctrl=record.get("possession_lost_ctrl") or 0,
        error_lead_to_goal=record.get("error_lead_to_goal") or 0,
        team_possession_pct=float(record.get("team_possession_pct") or 0),
        team_total_shots=record.get("team_total_shots") or 0,
        finishing_score=finishing_scores.get((match_id, player_id), 0.0),
    )

    sofascore_rating = float(record.get("sofascore_rating") or 0)

    if position_key == "W":
        final_rating, scores = calculate_winger_rating(stats, config)
        return True, (
            match_id,
            player_id,
            position_key,
            scores.productive_dribbling_raw,
            scores.productive_dribbling_norm,
            scores.chance_creation_raw,
            scores.chance_creation_norm,
            scores.goal_contribution_raw,
            scores.goal_contribution_norm,
            scores.carrying_raw,
            scores.carrying_norm,
            scores.shot_generation_raw,
            scores.shot_generation_norm,
            scores.defensive_raw,
            scores.defensive_norm,
            scores.presence_raw,
            scores.presence_norm,
            final_rating,
            sofascore_rating,
        )

    if position_key == "CM":
        final_rating, scores = calculate_cm_rating(stats, config)
        return True, (
            match_id,
            player_id,
            position_key,
            scores.passing_progression_raw,
            scores.passing_progression_norm,
            scores.carrying_raw,
            scores.carrying_norm,
            scores.chance_creation_raw,
            scores.chance_creation_norm,
            scores.defensive_raw,
            scores.defensive_norm,
            scores.goal_threat_raw,
            scores.goal_threat_norm,
            final_rating,
            sofascore_rating,
        )

    if position_key == "CAM":
        final_rating, scores = calculate_cam_rating(stats, config)
        return True, (
            match_id,
            player_id,
            position_key,
            scores.chance_creation_raw,
            scores.chance_creation_norm,
            scores.goal_threat_raw,
            scores.goal_threat_norm,
            scores.team_function_raw,
            scores.team_function_norm,
            scores.carrying_raw,
            scores.carrying_norm,
            scores.defensive_raw,
            scores.defensive_norm,
            final_rating,
            sofascore_rating,
        )

    final_rating, scores = calculate_match_rating(stats, config)
    return True, (
        match_id,
        player_id,
        position_key,
        scores.finishing_raw,
        scores.finishing_norm,
        scores.shot_generation_raw,
        scores.shot_generation_norm,
        scores.chance_creation_raw,
        scores.chance_creation_norm,
        scores.team_function_raw,
        scores.team_function_norm,
        scores.carrying_raw,
        scores.carrying_norm,
        scores.duels_raw,
        scores.duels_norm,
        scores.defensive_raw,
        scores.defensive_norm,
        final_rating,
        sofascore_rating,
    )


def main():
    log.info("Starting Know Ball rating engine")
    db = DB()

    available = get_available_positions()
    configs = {}
    for pos in available:
        configs[pos] = load_position_config(pos)
    log.info(f"Loaded configs for positions: {available}")

    rated_count = 0
    skipped_count = 0
    last_id = 0

    while True:
        unrated = get_unrated_records_batch(db, last_id, BATCH_SIZE)
        if not unrated:
            break

        finishing_scores = get_finishing_scores_batch(db, unrated)

        st_batch = []
        w_batch = []
        cam_batch = []
        cm_batch = []
        batch_rated = 0
        for record in unrated:
            try:
                success, rating_data = rate_record(record, configs, finishing_scores)
                if success:
                    rated_count += 1
                    batch_rated += 1
                    # rating_data[2] is position_key
                    if rating_data[2] == "W":
                        w_batch.append(rating_data)
                    elif rating_data[2] == "CAM":
                        cam_batch.append(rating_data)
                    elif rating_data[2] == "CM":
                        cm_batch.append(rating_data)
                    else:
                        st_batch.append(rating_data)
                else:
                    skipped_count += 1
            except Exception as e:
                log.error(
                    f"Error rating player {record['player_id']} match {record['match_id']}: {e}"
                )
                skipped_count += 1

        if st_batch:
            try:
                db.execute(
                    """INSERT INTO match_ratings
                       (match_id, player_id, position,
                        finishing_raw, finishing_norm,
                        shot_generation_raw, shot_generation_norm,
                        chance_creation_raw, chance_creation_norm,
                        team_function_raw, team_function_norm,
                        carrying_raw, carrying_norm,
                        duels_raw, duels_norm,
                        defensive_raw, defensive_norm,
                        final_rating, sofascore_rating)
                       VALUES %s
                       ON CONFLICT (match_id, player_id) DO NOTHING""",
                    (st_batch,),
                )
            except Exception as e:
                log.error(f"ST batch insert failed ({len(st_batch)} records): {e}")
                rated_count -= len(st_batch)
                skipped_count += len(st_batch)

        if w_batch:
            try:
                db.execute(
                    """INSERT INTO match_ratings
                       (match_id, player_id, position,
                        productive_dribbling_raw, productive_dribbling_norm,
                        chance_creation_raw, chance_creation_norm,
                        goal_contribution_raw, goal_contribution_norm,
                        carrying_raw, carrying_norm,
                        shot_generation_raw, shot_generation_norm,
                        defensive_raw, defensive_norm,
                        presence_raw, presence_norm,
                        final_rating, sofascore_rating)
                       VALUES %s
                       ON CONFLICT (match_id, player_id) DO NOTHING""",
                    (w_batch,),
                )
            except Exception as e:
                log.error(f"W batch insert failed ({len(w_batch)} records): {e}")
                rated_count -= len(w_batch)
                skipped_count += len(w_batch)

        if cam_batch:
            try:
                db.execute(
                    """INSERT INTO match_ratings
                       (match_id, player_id, position,
                        chance_creation_raw, chance_creation_norm,
                        goal_threat_raw, goal_threat_norm,
                        team_function_raw, team_function_norm,
                        carrying_raw, carrying_norm,
                        defensive_raw, defensive_norm,
                        final_rating, sofascore_rating)
                       VALUES %s
                       ON CONFLICT (match_id, player_id) DO NOTHING""",
                    (cam_batch,),
                )
            except Exception as e:
                log.error(f"CAM batch insert failed ({len(cam_batch)} records): {e}")
                rated_count -= len(cam_batch)
                skipped_count += len(cam_batch)

        if cm_batch:
            try:
                db.execute(
                    """INSERT INTO match_ratings
                       (match_id, player_id, position,
                        passing_progression_raw, passing_progression_norm,
                        carrying_raw, carrying_norm,
                        chance_creation_raw, chance_creation_norm,
                        defensive_raw, defensive_norm,
                        goal_threat_raw, goal_threat_norm,
                        final_rating, sofascore_rating)
                       VALUES %s
                       ON CONFLICT (match_id, player_id) DO NOTHING""",
                    (cm_batch,),
                )
            except Exception as e:
                log.error(f"CM batch insert failed ({len(cm_batch)} records): {e}")
                rated_count -= len(cm_batch)
                skipped_count += len(cm_batch)

        last_id = unrated[-1]["id"]
        log.info(
            f"Processed batch ending at mps.id={last_id}: "
            f"{batch_rated} rated ({len(st_batch)} ST, {len(w_batch)} W, "
            f"{len(cam_batch)} CAM, {len(cm_batch)} CM), "
            f"{len(unrated) - batch_rated} skipped"
        )

    db.close()
    log.info(f"Rating complete: {rated_count} rated, {skipped_count} skipped")


if __name__ == "__main__":
    main()
