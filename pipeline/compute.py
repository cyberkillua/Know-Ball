"""
Percentile Aggregator — all outfield positions.

Computes season-level aggregated stats and percentile ranks for players,
grouped by position. Each position group is ranked only against players
in the same group. Runs after rate.py.
"""

import statistics
from collections import defaultdict

from pipeline.db import DB
from pipeline.logger import get_logger
log = get_logger("compute")

MIN_MINUTES = 300

# Profile positions → match_ratings position used for category norms.
# Groups that share a position label are ranked together.
POSITION_GROUPS: list[tuple[list[str], str, str]] = [
    (["ST", "CF"],              "ST",     "ST"),
    (["CAM"],                   "MID",    "CAM"),
    (["LW", "RW", "LM", "RM"], "WINGER", "WINGER"),
    (["CM"],                    "MID",    "CM"),
    (["CDM"],                   "MID",    "CDM"),
    (["CB", "LB", "RB", "LWB", "RWB"], "DEF", "DEF"),
]
# Each tuple: (profile_positions, rating_position, label)
# profile_positions — kept for reference / legacy; peer grouping now uses dominant match position
# rating_position   — the match_ratings.position value used to identify this group
# label             — stored in peer_ratings.position


def percentile_of(value: float, all_values: list[float]) -> int:
    """Return the 0-100 percentile rank of value within all_values (higher = better)."""
    if not all_values:
        return 0
    below = sum(1 for v in all_values if v < value)
    equal = sum(1 for v in all_values if v == value)
    pct = (below + 0.5 * equal) / len(all_values) * 100
    return round(pct)


NULL_PERCENTILE_COLS = (
    "goals_per90_percentile",
    "shots_per90_percentile",
    "xg_per90_percentile",
    "xgot_per90_percentile",
    "xg_per_shot_percentile",
    "shot_on_target_percentile",
    "big_chances_missed_percentile",
    "finishing_percentile",
    "involvement_percentile",
    "carrying_percentile",
    "physical_percentile",
    "pressing_percentile",
    "overall_percentile",
    "xg_plus_xa_percentile",
    "xg_overperformance_percentile",
    "dribble_success_percentile",
    "shot_conversion_percentile",
    "big_chances_created_percentile",
    "xa_per90_percentile",
    "assists_per90_percentile",
    "key_passes_per90_percentile",
    "accurate_cross_per90_percentile",
    "dribbles_per90_percentile",
    "touches_per90_percentile",
    "fouls_won_per90_percentile",
    "aerials_per90_percentile",
    "ground_duels_won_per90_percentile",
    "total_contest_per90_percentile",
    "tackles_per90_percentile",
    "interceptions_per90_percentile",
    "ball_recoveries_per90_percentile",
    "goals_raw_percentile",
    "assists_raw_percentile",
    "shots_raw_percentile",
    "xg_raw_percentile",
    "xa_raw_percentile",
    "key_passes_raw_percentile",
    "big_chances_created_raw_percentile",
    "big_chances_missed_raw_percentile",
    "accurate_cross_raw_percentile",
    "dribbles_raw_percentile",
    "fouls_won_raw_percentile",
    "touches_raw_percentile",
    "aerials_won_raw_percentile",
    "ground_duels_won_raw_percentile",
    "total_contests_raw_percentile",
    "tackles_raw_percentile",
    "interceptions_raw_percentile",
    "ball_recoveries_raw_percentile",
    "fouls_committed_raw_percentile",
    "np_goals_per90_percentile",
    "np_xg_per90_percentile",
    "np_xg_per_shot_percentile",
    "np_goals_raw_percentile",
    "np_xg_raw_percentile",
    "passes_completed_per90_percentile",
    "passes_completed_raw_percentile",
    "passing_accuracy_percentile",
    "accurate_long_balls_per90_percentile",
    "accurate_long_balls_raw_percentile",
    "long_ball_accuracy_percentile",
    "xg_chain_per90_percentile",
    "xg_chain_raw_percentile",
    "xg_buildup_per90_percentile",
    "xg_buildup_raw_percentile",
    "shot_generation_percentile",
    "chance_creation_percentile",
    "team_function_percentile",
    "duels_percentile",
    "defensive_percentile",
    "model_score",
    "impact_rate",
    "aerial_win_rate_percentile",
    "ground_duel_win_rate_percentile",
)

# Columns that require match_ratings data (peer comparison / model score).
# Nulled out when a position has no rating config.
NULL_RATING_COLS = (
    "finishing_percentile",
    "involvement_percentile",
    "carrying_percentile",
    "physical_percentile",
    "pressing_percentile",
    "overall_percentile",
    "shot_generation_percentile",
    "chance_creation_percentile",
    "team_function_percentile",
    "duels_percentile",
    "defensive_percentile",
    "model_score",
    "impact_rate",
)


def compute_peer_ratings(
    db: DB,
    profile_positions: list[str],
    rating_position: str,
    position_label: str,
) -> None:
    """
    Compute and upsert peer_ratings for a group of positions.

    Players are ranked only against others in the same profile_positions group,
    within the same league and season.
    """
    log.info(f"[{position_label}] Fetching stats (dominant position = {rating_position})")

    stat_rows = db.query(
        """
        WITH pos_minutes AS (
            -- Minutes per player per peer group (using position_played, not model key)
            -- This preserves CAM vs CM vs CDM which all share the same 'MID' model
            SELECT
                mps.player_id,
                mat.league_id,
                mat.season,
                CASE
                    WHEN mps.position_played IN ('ST', 'CF', 'SS')           THEN 'ST'
                    WHEN mps.position_played IN ('LW', 'RW', 'LM', 'RM')    THEN 'WINGER'
                    WHEN mps.position_played IN ('CAM', 'AM')                THEN 'CAM'
                    WHEN mps.position_played IN ('CM', 'DM')                 THEN 'CM'
                    WHEN mps.position_played IN ('CDM')                      THEN 'CDM'
                    WHEN mps.position_played IN ('CB', 'LB', 'RB', 'LWB', 'RWB') THEN 'DEF'
                    ELSE NULL
                END                                                         AS position_group,
                SUM(mps.minutes_played)                                     AS mins
            FROM match_player_stats mps
            JOIN matches mat ON mat.id = mps.match_id
            WHERE mps.position_played IS NOT NULL
            GROUP BY mps.player_id, mat.league_id, mat.season,
                CASE
                    WHEN mps.position_played IN ('ST', 'CF', 'SS')           THEN 'ST'
                    WHEN mps.position_played IN ('LW', 'RW', 'LM', 'RM')    THEN 'WINGER'
                    WHEN mps.position_played IN ('CAM', 'AM')                THEN 'CAM'
                    WHEN mps.position_played IN ('CM', 'DM')                 THEN 'CM'
                    WHEN mps.position_played IN ('CDM')                      THEN 'CDM'
                    WHEN mps.position_played IN ('CB', 'LB', 'RB', 'LWB', 'RWB') THEN 'DEF'
                    ELSE NULL
                END
        ),
        dominant_pos AS (
            -- Keep only the group each player spent the most minutes in
            SELECT player_id, league_id, season, position_group AS dominant_group,
                   ROW_NUMBER() OVER (
                       PARTITION BY player_id, league_id, season
                       ORDER BY mins DESC
                   ) AS rn
            FROM pos_minutes
            WHERE position_group IS NOT NULL
        )
        SELECT
            mps.player_id,
            p.position                                               AS player_position,
            mat.league_id,
            mat.season,

            COUNT(DISTINCT mps.match_id)::int                       AS matches_played,
            SUM(mps.minutes_played)::int                            AS minutes_played,

            -- Raw season totals
            SUM(mps.goals)::int                                     AS goals_total,
            ROUND(SUM(mps.xg)::numeric, 3)                         AS xg_total,
            ROUND(SUM(mps.xa)::numeric, 3)                         AS xa_total,
            ROUND(SUM(mps.xgot)::numeric, 3)                       AS xgot_total,
            SUM(mps.shots_total)::int                               AS shots_total,
            SUM(mps.shots_on_target)::int                           AS shots_on_target,
            SUM(mps.assists)::int                                   AS assists_total,
            SUM(mps.successful_dribbles)::int                       AS dribbles_successful,
            SUM(mps.failed_dribbles)::int                          AS dribbles_failed,
            SUM(mps.aerial_duels_won)::int                         AS aerial_won,
            SUM(mps.aerial_duels_lost)::int                        AS aerial_lost,
            SUM(mps.ground_duels_won)::int                         AS ground_duels_won,
            SUM(mps.ground_duels_lost)::int                        AS ground_duels_lost,
            SUM(mps.tackles_won)::int                              AS tackles_total,
            SUM(mps.big_chance_created)::int                       AS big_chances_created,
            SUM(mps.big_chance_missed)::int                        AS big_chances_missed,
            SUM(mps.ball_recovery)::int                            AS ball_recoveries,
            SUM(mps.key_passes)::int                               AS key_passes_total,
            SUM(mps.accurate_cross)::int                           AS accurate_cross_total,
            SUM(mps.fouls_won)::int                                AS fouls_won_total,
            SUM(mps.touches)::int                                  AS touches_total,
            SUM(mps.interceptions)::int                            AS interceptions_total,
            SUM(mps.fouls_committed)::int                          AS fouls_committed_total,
            SUM(mps.penalty_goals)::int                             AS penalty_goals_total,
            (SUM(mps.goals) - SUM(mps.penalty_goals))::int         AS np_goals_total,
            SUM(mps.penalty_won)::int                              AS penalty_won_total,
            SUM(mps.possession_lost_ctrl)::int                     AS possession_lost_ctrl_total,
            SUM(mps.error_lead_to_goal)::int                       AS error_lead_to_goal_total,
            SUM(COALESCE(mps.self_created_goals, 0))::int          AS self_created_goals_total,
            SUM(COALESCE(mps.self_created_shots, 0))::int          AS self_created_shots_total,
            ROUND(SUM(mps.np_xg)::numeric, 4)                     AS np_xg_total,
            SUM(mps.np_shots)::int                                 AS np_shots_total,
            SUM(mps.passes_completed)::int                         AS passes_completed_total,
            SUM(mps.passes_total)::int                             AS passes_total_total,
            SUM(mps.accurate_long_balls)::int                      AS accurate_long_balls_total,
            SUM(mps.total_long_balls)::int                         AS total_long_balls_total,
            MAX(psu.xg_chain_per90)                                AS xg_chain_per90,
            MAX(psu.xg_chain)                                      AS xg_chain_raw,
            MAX(psu.xg_buildup_per90)                              AS xg_buildup_per90,
            MAX(psu.xg_buildup)                                    AS xg_buildup_raw
        FROM match_player_stats mps
        JOIN matches mat ON mat.id = mps.match_id
        JOIN players p ON p.id = mps.player_id
        JOIN dominant_pos dp
            ON dp.player_id = mps.player_id
            AND dp.league_id = mat.league_id
            AND dp.season = mat.season
            AND dp.rn = 1
        LEFT JOIN player_season_understat psu
            ON psu.player_id = mps.player_id AND psu.season = mat.season
        WHERE dp.dominant_group = %(position_label)s
        GROUP BY mps.player_id, p.position, mat.league_id, mat.season
        """,
        {"position_label": position_label},
    )

    if not stat_rows:
        log.info(f"[{position_label}] No records found, skipping")
        return

    log.info(f"[{position_label}] {len(stat_rows)} player-league-season groups (stats)")

    norm_rows = db.query(
        """
        SELECT
            mr.player_id,
            mat.league_id,
            mat.season,
            SUM(mps.minutes_played)::int                                                                              AS rated_minutes,
            ROUND((SUM(mr.final_rating * mps.minutes_played) / NULLIF(SUM(mps.minutes_played), 0))::numeric, 2)      AS avg_match_rating,
            ROUND(AVG(mr.finishing_raw)::numeric, 4)                                                                  AS avg_finishing_raw,
            ROUND(AVG(mr.shot_generation_raw)::numeric, 4)                                                            AS avg_shot_generation_raw,
            ROUND(AVG(mr.chance_creation_raw)::numeric, 4)                                                            AS avg_chance_creation_raw,
            ROUND(AVG(mr.team_function_raw)::numeric, 4)                                                              AS avg_team_function_raw,
            ROUND(AVG(mr.carrying_raw)::numeric, 4)                                                                   AS avg_carrying_raw,
            ROUND(AVG(mr.duels_raw)::numeric, 4)                                                                      AS avg_duels_raw,
            ROUND(AVG(mr.defensive_raw)::numeric, 4)                                                                  AS avg_defensive_raw,
            ROUND(STDDEV(mr.finishing_raw)::numeric, 4)                                                               AS finishing_stddev,
            ROUND((PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY mr.finishing_raw))::numeric, 4)                        AS finishing_p90,
            ROUND(STDDEV(mr.shot_generation_raw)::numeric, 4)                                                         AS shot_generation_stddev,
            ROUND((PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY mr.shot_generation_raw))::numeric, 4)                  AS shot_generation_p90,
            ROUND(STDDEV(mr.chance_creation_raw)::numeric, 4)                                                         AS chance_creation_stddev,
            ROUND((PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY mr.chance_creation_raw))::numeric, 4)                  AS chance_creation_p90,
            ROUND(STDDEV(mr.carrying_raw)::numeric, 4)                                                                AS carrying_stddev,
            ROUND((PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY mr.carrying_raw))::numeric, 4)                         AS carrying_p90,
            ROUND(STDDEV(mr.duels_raw)::numeric, 4)                                                                   AS duels_stddev,
            ROUND((PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY mr.duels_raw))::numeric, 4)                            AS duels_p90,
            ROUND(STDDEV(mr.defensive_raw)::numeric, 4)                                                               AS defensive_stddev,
            ROUND((PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY mr.defensive_raw))::numeric, 4)                        AS defensive_p90,
            ROUND(STDDEV(mr.final_rating)::numeric, 4)                                                                AS model_score_stddev,
            ROUND((PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY mr.final_rating))::numeric, 4)                         AS model_score_p90,
            ROUND(
                (COUNT(*) FILTER (WHERE mr.finishing_raw > 0))::numeric
                / NULLIF(COUNT(*), 0) * 100,
                1
            ) AS consistency_score,
            ROUND(
                (COUNT(*) FILTER (WHERE mr.finishing_raw > 0.5))::numeric
                / NULLIF(COUNT(*), 0) * 100,
                1
            ) AS impact_rate
        FROM match_ratings mr
        JOIN matches mat ON mat.id = mr.match_id
        JOIN match_player_stats mps ON mps.match_id = mr.match_id AND mps.player_id = mr.player_id
        WHERE mr.position = %(rating_position)s
        GROUP BY mr.player_id, mat.league_id, mat.season
        """,
        {"rating_position": rating_position},
    )

    norm_lookup: dict[tuple, dict] = {
        (r["player_id"], r["league_id"], r["season"]): r for r in norm_rows
    }

    log.info(f"[{position_label}] {len(norm_rows)} player-league-season groups (norms)")

    players: list[dict] = []
    for r in stat_rows:
        minutes = r["minutes_played"] or 1
        per90 = minutes / 90.0

        goals = r["goals_total"] or 0
        xg = float(r["xg_total"] or 0)
        xa = float(r["xa_total"] or 0)
        xgot = float(r["xgot_total"] or 0)
        shots = r["shots_total"] or 0
        shots_on = r["shots_on_target"] or 0
        dribbles_ok = r["dribbles_successful"] or 0
        dribbles_fail = r["dribbles_failed"] or 0
        aerial_won = r["aerial_won"] or 0
        aerial_lost = r["aerial_lost"] or 0
        ground_won = r["ground_duels_won"] or 0
        ground_lost = r["ground_duels_lost"] or 0
        bcc = r["big_chances_created"] or 0
        bcm = r["big_chances_missed"] or 0
        recoveries = r["ball_recoveries"] or 0
        assists = r["assists_total"] or 0
        key_passes = r["key_passes_total"] or 0
        accurate_cross = r["accurate_cross_total"] or 0
        fouls_won = r["fouls_won_total"] or 0
        touches = r["touches_total"] or 0
        tackles = r["tackles_total"] or 0
        interceptions = r["interceptions_total"] or 0
        fouls_committed = r["fouls_committed_total"] or 0
        np_goals = r["np_goals_total"] or 0
        np_xg = float(r["np_xg_total"] or 0)
        np_shots = r["np_shots_total"] or 0
        passes_completed = r["passes_completed_total"] or 0
        passes_total_val = r["passes_total_total"] or 0
        accurate_long_balls = r["accurate_long_balls_total"] or 0
        total_long_balls = r["total_long_balls_total"] or 0
        xg_chain_per90_val = float(r["xg_chain_per90"]) if r["xg_chain_per90"] is not None else None
        xg_chain_raw_val = float(r["xg_chain_raw"]) if r["xg_chain_raw"] is not None else None
        xg_buildup_per90_val = float(r["xg_buildup_per90"]) if r["xg_buildup_per90"] is not None else None
        xg_buildup_raw_val = float(r["xg_buildup_raw"]) if r["xg_buildup_raw"] is not None else None

        norm = norm_lookup.get((r["player_id"], r["league_id"], r["season"]), {})
        rated_minutes = norm.get("rated_minutes") or 0

        def _norm_float(key: str) -> float | None:
            v = norm.get(key)
            return float(v) if v is not None else None

        p = {
            "player_id": r["player_id"],
            "league_id": r["league_id"],
            "season": r["season"],
            "position": r["player_position"],
            "matches_played": r["matches_played"],
            "minutes_played": minutes,
            "rated_minutes": rated_minutes,
            "avg_match_rating": float(norm.get("avg_match_rating") or 0),
            "finishing_stddev":       _norm_float("finishing_stddev"),
            "finishing_p90":          _norm_float("finishing_p90"),
            "shot_generation_stddev": _norm_float("shot_generation_stddev"),
            "shot_generation_p90":    _norm_float("shot_generation_p90"),
            "chance_creation_stddev": _norm_float("chance_creation_stddev"),
            "chance_creation_p90":    _norm_float("chance_creation_p90"),
            "carrying_stddev":        _norm_float("carrying_stddev"),
            "carrying_p90":           _norm_float("carrying_p90"),
            "duels_stddev":           _norm_float("duels_stddev"),
            "duels_p90":              _norm_float("duels_p90"),
            "defensive_stddev":       _norm_float("defensive_stddev"),
            "defensive_p90":          _norm_float("defensive_p90"),
            "model_score_stddev":     _norm_float("model_score_stddev"),
            "model_score_p90":        _norm_float("model_score_p90"),
            "consistency_score":      float(norm.get("consistency_score") or 0.0),
            "impact_rate":            float(norm.get("impact_rate") or 0.0),
            # Per-90s
            "goals_per90": round(goals / per90, 2),
            "shots_per90": round(shots / per90, 2),
            "xg_per90": round(xg / per90, 2),
            "xgot_per90": round(xgot / per90, 2),
            "xa_per90": round(xa / per90, 2),
            "assists_per90": round(assists / per90, 2),
            "key_passes_per90": round(key_passes / per90, 2),
            "accurate_cross_per90": round(accurate_cross / per90, 2),
            "dribbles_per90": round(dribbles_ok / per90, 2),
            "aerial_wins_per90": round(aerial_won / per90, 2),
            "tackles_per90": round(tackles / per90, 2),
            "touches_per90": round(touches / per90, 2),
            "fouls_won_per90": round(fouls_won / per90, 2),
            "ground_duels_won_per90": round(ground_won / per90, 2),
            "total_contest_per90": round(
                (aerial_won + aerial_lost + ground_won + ground_lost) / per90, 2
            ),
            "interceptions_per90": round(interceptions / per90, 2),
            "xg_plus_xa_per90": round((xg + xa) / per90, 2),
            "xg_overperformance": round(goals - xg, 2),
            "dribble_success_rate": round(
                dribbles_ok / max(dribbles_ok + dribbles_fail, 1), 2
            ),
            "big_chances_created_per90": round(bcc / per90, 2),
            "big_chances_missed_per90": round(bcm / per90, 2),
            "shot_conversion_rate": round(goals / max(shots, 1), 2),
            "shot_on_target_rate": round(shots_on / max(shots, 1), 3),
            "ball_recovery_per90": round(recoveries / per90, 2),
            "xg_per_shot": round(xg / max(shots, 1), 3),
            "np_goals_per90": round(np_goals / per90, 2),
            "np_xg_per90": round(np_xg / per90, 2),
            "np_xg_per_shot": round(np_xg / max(np_shots, 1), 3),
            "np_goals_raw": np_goals,
            "np_xg_raw": np_xg,
            # Raw totals (prefixed _ = used for percentile ranking only)
            "_np_goals_raw": np_goals,
            "_np_xg_raw": np_xg,
            # Passing stats
            "passes_completed_per90": round(passes_completed / per90, 2),
            "passing_accuracy": round(passes_completed / max(passes_total_val, 1), 3),
            "accurate_long_balls_per90": round(accurate_long_balls / per90, 2),
            "long_ball_accuracy": round(accurate_long_balls / max(total_long_balls, 1), 3),
            "_passes_completed_raw": passes_completed,
            "_accurate_long_balls_raw": accurate_long_balls,
            # xGChain / xGBuildup from Understat (None if not available)
            "xg_chain_per90": xg_chain_per90_val,
            "xg_chain_raw": xg_chain_raw_val,
            "xg_buildup_per90": xg_buildup_per90_val,
            "xg_buildup_raw": xg_buildup_raw_val,
            "_goals_raw": goals,
            "_assists_raw": assists,
            "_shots_raw": shots,
            "_xg_raw": xg,
            "_xa_raw": xa,
            "_key_passes_raw": key_passes,
            "_big_chances_created_raw": bcc,
            "_big_chances_missed_raw": bcm,
            "_accurate_cross_raw": accurate_cross,
            "_dribbles_raw": dribbles_ok,
            "_fouls_won_raw": fouls_won,
            "_touches_raw": touches,
            "_aerials_won_raw": aerial_won,
            "_ground_duels_won_raw": ground_won,
            "aerial_win_rate": round(aerial_won / max(aerial_won + aerial_lost, 1), 3),
            "ground_duel_win_rate": round(ground_won / max(ground_won + ground_lost, 1), 3),
            "_total_contests_raw": aerial_won + aerial_lost + ground_won + ground_lost,
            "_tackles_raw": tackles,
            "_interceptions_raw": interceptions,
            "_ball_recoveries_raw": recoveries,
            "_fouls_committed_raw": fouls_committed,
        }

        # Dimension scores — per-match averages from match_ratings (correct scale)
        def _dim(key: str) -> float:
            v = norm.get(key)
            return float(v) if v is not None else 0.0

        p["_dim_finishing"]       = _dim("avg_finishing_raw")
        p["_dim_shot_generation"] = _dim("avg_shot_generation_raw")
        p["_dim_chance_creation"] = _dim("avg_chance_creation_raw")
        p["_dim_team_function"]   = _dim("avg_team_function_raw")
        p["_dim_carrying"]        = _dim("avg_carrying_raw")
        p["_dim_duels"]           = _dim("avg_duels_raw")
        p["_dim_defensive"]       = _dim("avg_defensive_raw")
        players.append(p)

    # Group by (league_id, season) — rank within same league+season only
    groups: dict[tuple, list[dict]] = defaultdict(list)
    for p in players:
        groups[(p["league_id"], p["season"])].append(p)

    for (league_id, season), group in groups.items():
        # stat_qualified: enough minutes for stat percentiles (no match ratings needed)
        stat_qualified = [
            p for p in group
            if p["minutes_played"] >= MIN_MINUTES
        ]
        # qualified: also has match ratings — needed for model/dimension percentiles
        qualified = [
            p for p in stat_qualified
            if p["rated_minutes"] is not None
            and p["rated_minutes"] > 0
        ]

        if not stat_qualified:
            for p in group:
                for col in NULL_PERCENTILE_COLS:
                    p[col] = None
            continue

        def vals(key: str, source: list | None = None) -> list[float]:
            src = source if source is not None else stat_qualified
            return [float(p[key]) for p in src]

        # Stat distribution vals — ranked among all players with sufficient minutes
        goals_per90_vals             = vals("goals_per90")
        shots_per90_vals             = vals("shots_per90")
        xg_per90_vals                = vals("xg_per90")
        xgot_per90_vals              = vals("xgot_per90")
        xg_per_shot_vals             = vals("xg_per_shot")
        sot_rate_vals                = vals("shot_on_target_rate")
        xg_xa_vals                   = vals("xg_plus_xa_per90")
        overperf_vals                = vals("xg_overperformance")
        drib_rate_vals               = vals("dribble_success_rate")
        conversion_vals              = vals("shot_conversion_rate")
        bcc_vals                     = vals("big_chances_created_per90")
        bcm_vals                     = vals("big_chances_missed_per90")
        xa_vals                      = vals("xa_per90")
        assists_vals                 = vals("assists_per90")
        key_passes_vals              = vals("key_passes_per90")
        accurate_cross_vals          = vals("accurate_cross_per90")
        dribbles_per90_vals          = vals("dribbles_per90")
        touches_per90_vals           = vals("touches_per90")
        fouls_won_per90_vals         = vals("fouls_won_per90")
        aerials_per90_vals           = vals("aerial_wins_per90")
        ground_duels_won_per90_vals  = vals("ground_duels_won_per90")
        aerial_win_rate_vals         = vals("aerial_win_rate")
        ground_duel_win_rate_vals    = vals("ground_duel_win_rate")
        total_contest_per90_vals     = vals("total_contest_per90")
        tackles_per90_vals           = vals("tackles_per90")
        interceptions_per90_vals     = vals("interceptions_per90")
        ball_recoveries_per90_vals   = vals("ball_recovery_per90")
        goals_raw_vals               = vals("_goals_raw")
        assists_raw_vals             = vals("_assists_raw")
        shots_raw_vals               = vals("_shots_raw")
        xg_raw_vals                  = vals("_xg_raw")
        xa_raw_vals                  = vals("_xa_raw")
        key_passes_raw_vals          = vals("_key_passes_raw")
        bcc_raw_vals                 = vals("_big_chances_created_raw")
        bcm_raw_vals                 = vals("_big_chances_missed_raw")
        accurate_cross_raw_vals      = vals("_accurate_cross_raw")
        dribbles_raw_vals            = vals("_dribbles_raw")
        fouls_won_raw_vals           = vals("_fouls_won_raw")
        touches_raw_vals             = vals("_touches_raw")
        aerials_won_raw_vals         = vals("_aerials_won_raw")
        ground_duels_won_raw_vals    = vals("_ground_duels_won_raw")
        total_contests_raw_vals      = vals("_total_contests_raw")
        tackles_raw_vals             = vals("_tackles_raw")
        interceptions_raw_vals       = vals("_interceptions_raw")
        ball_recoveries_raw_vals     = vals("_ball_recoveries_raw")
        fouls_committed_raw_vals     = vals("_fouls_committed_raw")
        np_goals_per90_vals          = vals("np_goals_per90")
        np_xg_per90_vals             = vals("np_xg_per90")
        np_xg_per_shot_vals          = vals("np_xg_per_shot")
        np_goals_raw_vals            = vals("_np_goals_raw")
        np_xg_raw_vals               = vals("_np_xg_raw")
        passes_completed_per90_vals  = vals("passes_completed_per90")
        passing_accuracy_vals        = vals("passing_accuracy")
        accurate_lb_per90_vals       = vals("accurate_long_balls_per90")
        long_ball_accuracy_vals      = vals("long_ball_accuracy")
        passes_completed_raw_vals    = vals("_passes_completed_raw")
        accurate_lb_raw_vals         = vals("_accurate_long_balls_raw")
        # xGChain/xGBuildup — only rank players who have Understat data
        xg_chain_stat_q = [p for p in stat_qualified if p["xg_chain_per90"] is not None]
        xg_buildup_stat_q = [p for p in stat_qualified if p["xg_buildup_per90"] is not None]
        xg_chain_per90_vals  = [float(p["xg_chain_per90"]) for p in xg_chain_stat_q]
        xg_chain_raw_vals    = [float(p["xg_chain_raw"]) for p in xg_chain_stat_q]
        xg_buildup_per90_vals = [float(p["xg_buildup_per90"]) for p in xg_buildup_stat_q]
        xg_buildup_raw_vals  = [float(p["xg_buildup_raw"]) for p in xg_buildup_stat_q]

        # Dimension distribution vals — ranked only among players with match ratings
        if qualified:
            carrying_vals         = vals("_dim_carrying",        qualified)
            finishing_vals        = vals("_dim_finishing",       qualified)
            shot_generation_vals  = vals("_dim_shot_generation", qualified)
            chance_creation_vals  = vals("_dim_chance_creation", qualified)
            team_function_vals    = vals("_dim_team_function",   qualified)
            duels_vals            = vals("_dim_duels",           qualified)
            defensive_vals        = vals("_dim_defensive",       qualified)

            dim_keys    = ["_dim_finishing", "_dim_shot_generation", "_dim_chance_creation",
                           "_dim_team_function", "_dim_carrying", "_dim_duels", "_dim_defensive"]
            dim_weights = [0.35, 0.20, 0.15, 0.05, 0.10, 0.10, 0.05]

            def zscore_dim(key: str) -> dict:
                v = [float(p[key]) for p in qualified]
                mean = statistics.mean(v)
                stdev = statistics.stdev(v) if len(v) > 1 else 1.0
                return {p["player_id"]: (float(p[key]) - mean) / stdev if stdev else 0.0
                        for p in qualified}

            zscores = {key: zscore_dim(key) for key in dim_keys}
            overall_vals = [
                sum(w * zscores[k][p["player_id"]] for k, w in zip(dim_keys, dim_weights))
                for p in qualified
            ]

        # Stat percentiles — all players with sufficient minutes
        for p in stat_qualified:
            p["goals_per90_percentile"]           = percentile_of(p["goals_per90"],            goals_per90_vals)
            p["shots_per90_percentile"]           = percentile_of(p["shots_per90"],            shots_per90_vals)
            p["xg_per90_percentile"]              = percentile_of(p["xg_per90"],               xg_per90_vals)
            p["xgot_per90_percentile"]            = percentile_of(p["xgot_per90"],             xgot_per90_vals)
            p["xg_per_shot_percentile"]           = percentile_of(p["xg_per_shot"],            xg_per_shot_vals)
            p["shot_on_target_percentile"]        = percentile_of(p["shot_on_target_rate"],    sot_rate_vals)
            p["xg_plus_xa_percentile"]            = percentile_of(p["xg_plus_xa_per90"],       xg_xa_vals)
            p["xg_overperformance_percentile"]    = percentile_of(p["xg_overperformance"],     overperf_vals)
            p["dribble_success_percentile"]       = percentile_of(p["dribble_success_rate"],   drib_rate_vals)
            p["shot_conversion_percentile"]       = percentile_of(p["shot_conversion_rate"],   conversion_vals)
            p["big_chances_created_percentile"]   = percentile_of(p["big_chances_created_per90"], bcc_vals)
            p["big_chances_missed_percentile"]    = 100 - percentile_of(p["big_chances_missed_per90"], bcm_vals)
            p["xa_per90_percentile"]              = percentile_of(p["xa_per90"],               xa_vals)
            p["assists_per90_percentile"]         = percentile_of(p["assists_per90"],          assists_vals)
            p["key_passes_per90_percentile"]      = percentile_of(p["key_passes_per90"],       key_passes_vals)
            p["accurate_cross_per90_percentile"]  = percentile_of(p["accurate_cross_per90"],   accurate_cross_vals)
            p["dribbles_per90_percentile"]        = percentile_of(p["dribbles_per90"],         dribbles_per90_vals)
            p["touches_per90_percentile"]         = percentile_of(p["touches_per90"],          touches_per90_vals)
            p["fouls_won_per90_percentile"]       = percentile_of(p["fouls_won_per90"],        fouls_won_per90_vals)
            p["aerials_per90_percentile"]         = percentile_of(p["aerial_wins_per90"],      aerials_per90_vals)
            p["ground_duels_won_per90_percentile"]= percentile_of(p["ground_duels_won_per90"], ground_duels_won_per90_vals)
            p["aerial_win_rate_percentile"]       = percentile_of(p["aerial_win_rate"],        aerial_win_rate_vals)
            p["ground_duel_win_rate_percentile"]  = percentile_of(p["ground_duel_win_rate"],   ground_duel_win_rate_vals)
            p["total_contest_per90_percentile"]   = percentile_of(p["total_contest_per90"],    total_contest_per90_vals)
            p["tackles_per90_percentile"]         = percentile_of(p["tackles_per90"],          tackles_per90_vals)
            p["interceptions_per90_percentile"]   = percentile_of(p["interceptions_per90"],    interceptions_per90_vals)
            p["ball_recoveries_per90_percentile"] = percentile_of(p["ball_recovery_per90"],    ball_recoveries_per90_vals)
            p["goals_raw_percentile"]             = percentile_of(p["_goals_raw"],             goals_raw_vals)
            p["assists_raw_percentile"]           = percentile_of(p["_assists_raw"],           assists_raw_vals)
            p["shots_raw_percentile"]             = percentile_of(p["_shots_raw"],             shots_raw_vals)
            p["xg_raw_percentile"]                = percentile_of(p["_xg_raw"],                xg_raw_vals)
            p["xa_raw_percentile"]                = percentile_of(p["_xa_raw"],                xa_raw_vals)
            p["key_passes_raw_percentile"]        = percentile_of(p["_key_passes_raw"],        key_passes_raw_vals)
            p["big_chances_created_raw_percentile"] = percentile_of(p["_big_chances_created_raw"], bcc_raw_vals)
            p["big_chances_missed_raw_percentile"]= 100 - percentile_of(p["_big_chances_missed_raw"], bcm_raw_vals)
            p["accurate_cross_raw_percentile"]    = percentile_of(p["_accurate_cross_raw"],    accurate_cross_raw_vals)
            p["dribbles_raw_percentile"]          = percentile_of(p["_dribbles_raw"],          dribbles_raw_vals)
            p["fouls_won_raw_percentile"]         = percentile_of(p["_fouls_won_raw"],         fouls_won_raw_vals)
            p["touches_raw_percentile"]           = percentile_of(p["_touches_raw"],           touches_raw_vals)
            p["aerials_won_raw_percentile"]       = percentile_of(p["_aerials_won_raw"],       aerials_won_raw_vals)
            p["ground_duels_won_raw_percentile"]  = percentile_of(p["_ground_duels_won_raw"],  ground_duels_won_raw_vals)
            p["total_contests_raw_percentile"]    = percentile_of(p["_total_contests_raw"],    total_contests_raw_vals)
            p["tackles_raw_percentile"]           = percentile_of(p["_tackles_raw"],           tackles_raw_vals)
            p["interceptions_raw_percentile"]     = percentile_of(p["_interceptions_raw"],     interceptions_raw_vals)
            p["ball_recoveries_raw_percentile"]   = percentile_of(p["_ball_recoveries_raw"],   ball_recoveries_raw_vals)
            p["fouls_committed_raw_percentile"]   = 100 - percentile_of(p["_fouls_committed_raw"], fouls_committed_raw_vals)
            p["np_goals_per90_percentile"]        = percentile_of(p["np_goals_per90"],         np_goals_per90_vals)
            p["np_xg_per90_percentile"]           = percentile_of(p["np_xg_per90"],            np_xg_per90_vals)
            p["np_xg_per_shot_percentile"]        = percentile_of(p["np_xg_per_shot"],         np_xg_per_shot_vals)
            p["np_goals_raw_percentile"]          = percentile_of(p["_np_goals_raw"],          np_goals_raw_vals)
            p["np_xg_raw_percentile"]             = percentile_of(p["_np_xg_raw"],             np_xg_raw_vals)
            p["passes_completed_per90_percentile"] = percentile_of(p["passes_completed_per90"], passes_completed_per90_vals)
            p["passes_completed_raw_percentile"]  = percentile_of(p["_passes_completed_raw"],  passes_completed_raw_vals)
            p["passing_accuracy_percentile"]      = percentile_of(p["passing_accuracy"],       passing_accuracy_vals)
            p["accurate_long_balls_per90_percentile"] = percentile_of(p["accurate_long_balls_per90"], accurate_lb_per90_vals)
            p["accurate_long_balls_raw_percentile"] = percentile_of(p["_accurate_long_balls_raw"], accurate_lb_raw_vals)
            p["long_ball_accuracy_percentile"]    = percentile_of(p["long_ball_accuracy"],     long_ball_accuracy_vals)
            # xGChain/xGBuildup — None if player has no Understat data
            if p["xg_chain_per90"] is not None and xg_chain_per90_vals:
                p["xg_chain_per90_percentile"]    = percentile_of(p["xg_chain_per90"],        xg_chain_per90_vals)
                p["xg_chain_raw_percentile"]      = percentile_of(p["xg_chain_raw"],          xg_chain_raw_vals)
            else:
                p["xg_chain_per90_percentile"]    = None
                p["xg_chain_raw_percentile"]      = None
            if p["xg_buildup_per90"] is not None and xg_buildup_per90_vals:
                p["xg_buildup_per90_percentile"]  = percentile_of(p["xg_buildup_per90"],      xg_buildup_per90_vals)
                p["xg_buildup_raw_percentile"]    = percentile_of(p["xg_buildup_raw"],        xg_buildup_raw_vals)
            else:
                p["xg_buildup_per90_percentile"]  = None
                p["xg_buildup_raw_percentile"]    = None
            # Null model/dimension percentiles for players without match ratings
            if not p.get("rated_minutes"):
                for col in NULL_RATING_COLS:
                    p[col] = None

        # Model/dimension percentiles — only players with match ratings
        if qualified:
            for p in qualified:
                overall_score = sum(
                    w * zscores[k][p["player_id"]]
                    for k, w in zip(dim_keys, dim_weights)
                )
                p["finishing_percentile"]       = percentile_of(p["_dim_finishing"],         finishing_vals)
                p["involvement_percentile"]     = percentile_of(p["_dim_chance_creation"],   chance_creation_vals)
                p["carrying_percentile"]        = percentile_of(p["_dim_carrying"],          carrying_vals)
                p["physical_percentile"]        = percentile_of(p["_dim_duels"],             duels_vals)
                p["pressing_percentile"]        = percentile_of(p["_dim_defensive"],         defensive_vals)
                p["overall_percentile"]         = percentile_of(overall_score,               overall_vals)
                p["shot_generation_percentile"] = percentile_of(p["_dim_shot_generation"],   shot_generation_vals)
                p["chance_creation_percentile"] = percentile_of(p["_dim_chance_creation"],   chance_creation_vals)
                p["team_function_percentile"]   = percentile_of(p["_dim_team_function"],     team_function_vals)
                p["duels_percentile"]           = percentile_of(p["_dim_duels"],             duels_vals)
                p["defensive_percentile"]       = percentile_of(p["_dim_defensive"],         defensive_vals)
                p["model_score"]                = round(max(0.0, min(100.0, (overall_score + 3.0) / 6.0 * 100)), 2)

        for p in group:
            if p["minutes_played"] < MIN_MINUTES:
                for col in NULL_PERCENTILE_COLS:
                    p[col] = None

    upserted = 0
    for p in players:
        db.execute(
            """
            INSERT INTO peer_ratings (
                player_id, league_id, season, position,
                matches_played, minutes_played, rated_minutes, avg_match_rating,
                goals_per90, shots_per90, xg_per90, xgot_per90, xa_per90,
                assists_per90, key_passes_per90, accurate_cross_per90,
                dribbles_per90, aerial_wins_per90, tackles_per90,
                xg_plus_xa_per90, xg_overperformance,
                dribble_success_rate, big_chances_created_per90, big_chances_missed_per90,
                shot_conversion_rate, shot_on_target_rate, ball_recovery_per90, xg_per_shot,
                goals_per90_percentile, shots_per90_percentile,
                xg_per90_percentile, xgot_per90_percentile,
                xg_per_shot_percentile, shot_on_target_percentile,
                big_chances_missed_percentile,
                finishing_percentile, involvement_percentile, carrying_percentile,
                physical_percentile, pressing_percentile, overall_percentile,
                xg_plus_xa_percentile, xg_overperformance_percentile,
                dribble_success_percentile, shot_conversion_percentile,
                big_chances_created_percentile,
                xa_per90_percentile, assists_per90_percentile,
                key_passes_per90_percentile, accurate_cross_per90_percentile,
                dribbles_per90_percentile, touches_per90_percentile,
                fouls_won_per90_percentile, aerials_per90_percentile,
                ground_duels_won_per90_percentile, total_contest_per90_percentile,
                tackles_per90_percentile, interceptions_per90_percentile,
                ball_recoveries_per90_percentile,
                goals_raw_percentile, assists_raw_percentile, shots_raw_percentile,
                xg_raw_percentile, xa_raw_percentile, key_passes_raw_percentile,
                big_chances_created_raw_percentile, big_chances_missed_raw_percentile,
                accurate_cross_raw_percentile, dribbles_raw_percentile,
                fouls_won_raw_percentile, touches_raw_percentile,
                aerials_won_raw_percentile, ground_duels_won_raw_percentile,
                total_contests_raw_percentile, tackles_raw_percentile,
                interceptions_raw_percentile, ball_recoveries_raw_percentile,
                fouls_committed_raw_percentile,
                np_goals_per90, np_xg_per90, np_xg_per_shot,
                np_goals_raw, np_xg_raw,
                np_goals_per90_percentile, np_xg_per90_percentile, np_xg_per_shot_percentile,
                np_goals_raw_percentile, np_xg_raw_percentile,
                passes_completed_per90_percentile, passes_completed_raw_percentile,
                passing_accuracy_percentile,
                accurate_long_balls_per90_percentile, accurate_long_balls_raw_percentile,
                long_ball_accuracy_percentile,
                xg_chain_per90_percentile, xg_chain_raw_percentile,
                xg_buildup_per90_percentile, xg_buildup_raw_percentile,
                shot_generation_percentile, chance_creation_percentile,
                team_function_percentile, duels_percentile, defensive_percentile,
                model_score,
                finishing_stddev, finishing_p90,
                shot_generation_stddev, shot_generation_p90,
                chance_creation_stddev, chance_creation_p90,
                carrying_stddev, carrying_p90,
                duels_stddev, duels_p90,
                defensive_stddev, defensive_p90,
                model_score_stddev, model_score_p90,
                consistency_score,
                impact_rate,
                aerial_win_rate_percentile,
                ground_duel_win_rate_percentile
            ) VALUES (
                %(player_id)s, %(league_id)s, %(season)s, %(position)s,
                %(matches_played)s, %(minutes_played)s, %(rated_minutes)s, %(avg_match_rating)s,
                %(goals_per90)s, %(shots_per90)s, %(xg_per90)s, %(xgot_per90)s, %(xa_per90)s,
                %(assists_per90)s, %(key_passes_per90)s, %(accurate_cross_per90)s,
                %(dribbles_per90)s, %(aerial_wins_per90)s, %(tackles_per90)s,
                %(xg_plus_xa_per90)s, %(xg_overperformance)s,
                %(dribble_success_rate)s, %(big_chances_created_per90)s, %(big_chances_missed_per90)s,
                %(shot_conversion_rate)s, %(shot_on_target_rate)s, %(ball_recovery_per90)s, %(xg_per_shot)s,
                %(goals_per90_percentile)s, %(shots_per90_percentile)s,
                %(xg_per90_percentile)s, %(xgot_per90_percentile)s,
                %(xg_per_shot_percentile)s, %(shot_on_target_percentile)s,
                %(big_chances_missed_percentile)s,
                %(finishing_percentile)s, %(involvement_percentile)s, %(carrying_percentile)s,
                %(physical_percentile)s, %(pressing_percentile)s, %(overall_percentile)s,
                %(xg_plus_xa_percentile)s, %(xg_overperformance_percentile)s,
                %(dribble_success_percentile)s, %(shot_conversion_percentile)s,
                %(big_chances_created_percentile)s,
                %(xa_per90_percentile)s, %(assists_per90_percentile)s,
                %(key_passes_per90_percentile)s, %(accurate_cross_per90_percentile)s,
                %(dribbles_per90_percentile)s, %(touches_per90_percentile)s,
                %(fouls_won_per90_percentile)s, %(aerials_per90_percentile)s,
                %(ground_duels_won_per90_percentile)s, %(total_contest_per90_percentile)s,
                %(tackles_per90_percentile)s, %(interceptions_per90_percentile)s,
                %(ball_recoveries_per90_percentile)s,
                %(goals_raw_percentile)s, %(assists_raw_percentile)s, %(shots_raw_percentile)s,
                %(xg_raw_percentile)s, %(xa_raw_percentile)s, %(key_passes_raw_percentile)s,
                %(big_chances_created_raw_percentile)s, %(big_chances_missed_raw_percentile)s,
                %(accurate_cross_raw_percentile)s, %(dribbles_raw_percentile)s,
                %(fouls_won_raw_percentile)s, %(touches_raw_percentile)s,
                %(aerials_won_raw_percentile)s, %(ground_duels_won_raw_percentile)s,
                %(total_contests_raw_percentile)s, %(tackles_raw_percentile)s,
                %(interceptions_raw_percentile)s, %(ball_recoveries_raw_percentile)s,
                %(fouls_committed_raw_percentile)s,
                %(np_goals_per90)s, %(np_xg_per90)s, %(np_xg_per_shot)s,
                %(np_goals_raw)s, %(np_xg_raw)s,
                %(np_goals_per90_percentile)s, %(np_xg_per90_percentile)s, %(np_xg_per_shot_percentile)s,
                %(np_goals_raw_percentile)s, %(np_xg_raw_percentile)s,
                %(passes_completed_per90_percentile)s, %(passes_completed_raw_percentile)s,
                %(passing_accuracy_percentile)s,
                %(accurate_long_balls_per90_percentile)s, %(accurate_long_balls_raw_percentile)s,
                %(long_ball_accuracy_percentile)s,
                %(xg_chain_per90_percentile)s, %(xg_chain_raw_percentile)s,
                %(xg_buildup_per90_percentile)s, %(xg_buildup_raw_percentile)s,
                %(shot_generation_percentile)s, %(chance_creation_percentile)s,
                %(team_function_percentile)s, %(duels_percentile)s, %(defensive_percentile)s,
                %(model_score)s,
                %(finishing_stddev)s, %(finishing_p90)s,
                %(shot_generation_stddev)s, %(shot_generation_p90)s,
                %(chance_creation_stddev)s, %(chance_creation_p90)s,
                %(carrying_stddev)s, %(carrying_p90)s,
                %(duels_stddev)s, %(duels_p90)s,
                %(defensive_stddev)s, %(defensive_p90)s,
                %(model_score_stddev)s, %(model_score_p90)s,
                %(consistency_score)s,
                %(impact_rate)s,
                %(aerial_win_rate_percentile)s,
                %(ground_duel_win_rate_percentile)s
            )
            ON CONFLICT (player_id, league_id, season) DO UPDATE SET
                position                          = EXCLUDED.position,
                matches_played                    = EXCLUDED.matches_played,
                minutes_played                    = EXCLUDED.minutes_played,
                rated_minutes                     = EXCLUDED.rated_minutes,
                avg_match_rating                  = EXCLUDED.avg_match_rating,
                goals_per90                       = EXCLUDED.goals_per90,
                xg_per90                          = EXCLUDED.xg_per90,
                xgot_per90                        = EXCLUDED.xgot_per90,
                shots_per90                       = EXCLUDED.shots_per90,
                xa_per90                          = EXCLUDED.xa_per90,
                assists_per90                     = EXCLUDED.assists_per90,
                key_passes_per90                  = EXCLUDED.key_passes_per90,
                accurate_cross_per90              = EXCLUDED.accurate_cross_per90,
                dribbles_per90                    = EXCLUDED.dribbles_per90,
                aerial_wins_per90                 = EXCLUDED.aerial_wins_per90,
                tackles_per90                     = EXCLUDED.tackles_per90,
                xg_plus_xa_per90                  = EXCLUDED.xg_plus_xa_per90,
                xg_overperformance                = EXCLUDED.xg_overperformance,
                dribble_success_rate              = EXCLUDED.dribble_success_rate,
                big_chances_created_per90         = EXCLUDED.big_chances_created_per90,
                big_chances_missed_per90          = EXCLUDED.big_chances_missed_per90,
                shot_conversion_rate              = EXCLUDED.shot_conversion_rate,
                shot_on_target_rate               = EXCLUDED.shot_on_target_rate,
                ball_recovery_per90               = EXCLUDED.ball_recovery_per90,
                xg_per_shot                       = EXCLUDED.xg_per_shot,
                goals_per90_percentile            = EXCLUDED.goals_per90_percentile,
                shots_per90_percentile            = EXCLUDED.shots_per90_percentile,
                xg_per90_percentile               = EXCLUDED.xg_per90_percentile,
                xgot_per90_percentile             = EXCLUDED.xgot_per90_percentile,
                xg_per_shot_percentile            = EXCLUDED.xg_per_shot_percentile,
                shot_on_target_percentile         = EXCLUDED.shot_on_target_percentile,
                big_chances_missed_percentile     = EXCLUDED.big_chances_missed_percentile,
                finishing_percentile              = EXCLUDED.finishing_percentile,
                involvement_percentile            = EXCLUDED.involvement_percentile,
                carrying_percentile               = EXCLUDED.carrying_percentile,
                physical_percentile               = EXCLUDED.physical_percentile,
                pressing_percentile               = EXCLUDED.pressing_percentile,
                overall_percentile                = EXCLUDED.overall_percentile,
                xg_plus_xa_percentile             = EXCLUDED.xg_plus_xa_percentile,
                xg_overperformance_percentile     = EXCLUDED.xg_overperformance_percentile,
                dribble_success_percentile        = EXCLUDED.dribble_success_percentile,
                shot_conversion_percentile        = EXCLUDED.shot_conversion_percentile,
                big_chances_created_percentile    = EXCLUDED.big_chances_created_percentile,
                xa_per90_percentile               = EXCLUDED.xa_per90_percentile,
                assists_per90_percentile          = EXCLUDED.assists_per90_percentile,
                key_passes_per90_percentile       = EXCLUDED.key_passes_per90_percentile,
                accurate_cross_per90_percentile   = EXCLUDED.accurate_cross_per90_percentile,
                dribbles_per90_percentile         = EXCLUDED.dribbles_per90_percentile,
                touches_per90_percentile          = EXCLUDED.touches_per90_percentile,
                fouls_won_per90_percentile        = EXCLUDED.fouls_won_per90_percentile,
                aerials_per90_percentile          = EXCLUDED.aerials_per90_percentile,
                ground_duels_won_per90_percentile = EXCLUDED.ground_duels_won_per90_percentile,
                total_contest_per90_percentile    = EXCLUDED.total_contest_per90_percentile,
                tackles_per90_percentile          = EXCLUDED.tackles_per90_percentile,
                interceptions_per90_percentile    = EXCLUDED.interceptions_per90_percentile,
                ball_recoveries_per90_percentile  = EXCLUDED.ball_recoveries_per90_percentile,
                goals_raw_percentile              = EXCLUDED.goals_raw_percentile,
                assists_raw_percentile            = EXCLUDED.assists_raw_percentile,
                shots_raw_percentile              = EXCLUDED.shots_raw_percentile,
                xg_raw_percentile                 = EXCLUDED.xg_raw_percentile,
                xa_raw_percentile                 = EXCLUDED.xa_raw_percentile,
                key_passes_raw_percentile         = EXCLUDED.key_passes_raw_percentile,
                big_chances_created_raw_percentile = EXCLUDED.big_chances_created_raw_percentile,
                big_chances_missed_raw_percentile = EXCLUDED.big_chances_missed_raw_percentile,
                accurate_cross_raw_percentile     = EXCLUDED.accurate_cross_raw_percentile,
                dribbles_raw_percentile           = EXCLUDED.dribbles_raw_percentile,
                fouls_won_raw_percentile          = EXCLUDED.fouls_won_raw_percentile,
                touches_raw_percentile            = EXCLUDED.touches_raw_percentile,
                aerials_won_raw_percentile        = EXCLUDED.aerials_won_raw_percentile,
                ground_duels_won_raw_percentile   = EXCLUDED.ground_duels_won_raw_percentile,
                total_contests_raw_percentile     = EXCLUDED.total_contests_raw_percentile,
                tackles_raw_percentile            = EXCLUDED.tackles_raw_percentile,
                interceptions_raw_percentile      = EXCLUDED.interceptions_raw_percentile,
                ball_recoveries_raw_percentile    = EXCLUDED.ball_recoveries_raw_percentile,
                fouls_committed_raw_percentile    = EXCLUDED.fouls_committed_raw_percentile,
                np_goals_per90                    = EXCLUDED.np_goals_per90,
                np_xg_per90                       = EXCLUDED.np_xg_per90,
                np_xg_per_shot                    = EXCLUDED.np_xg_per_shot,
                np_goals_raw                      = EXCLUDED.np_goals_raw,
                np_xg_raw                         = EXCLUDED.np_xg_raw,
                np_goals_per90_percentile         = EXCLUDED.np_goals_per90_percentile,
                np_xg_per90_percentile            = EXCLUDED.np_xg_per90_percentile,
                np_xg_per_shot_percentile         = EXCLUDED.np_xg_per_shot_percentile,
                np_goals_raw_percentile           = EXCLUDED.np_goals_raw_percentile,
                np_xg_raw_percentile              = EXCLUDED.np_xg_raw_percentile,
                passes_completed_per90_percentile  = EXCLUDED.passes_completed_per90_percentile,
                passes_completed_raw_percentile    = EXCLUDED.passes_completed_raw_percentile,
                passing_accuracy_percentile        = EXCLUDED.passing_accuracy_percentile,
                accurate_long_balls_per90_percentile = EXCLUDED.accurate_long_balls_per90_percentile,
                accurate_long_balls_raw_percentile  = EXCLUDED.accurate_long_balls_raw_percentile,
                long_ball_accuracy_percentile      = EXCLUDED.long_ball_accuracy_percentile,
                xg_chain_per90_percentile          = EXCLUDED.xg_chain_per90_percentile,
                xg_chain_raw_percentile            = EXCLUDED.xg_chain_raw_percentile,
                xg_buildup_per90_percentile        = EXCLUDED.xg_buildup_per90_percentile,
                xg_buildup_raw_percentile          = EXCLUDED.xg_buildup_raw_percentile,
                shot_generation_percentile         = EXCLUDED.shot_generation_percentile,
                chance_creation_percentile         = EXCLUDED.chance_creation_percentile,
                team_function_percentile           = EXCLUDED.team_function_percentile,
                duels_percentile                   = EXCLUDED.duels_percentile,
                defensive_percentile               = EXCLUDED.defensive_percentile,
                model_score                        = EXCLUDED.model_score,
                finishing_stddev                   = EXCLUDED.finishing_stddev,
                finishing_p90                      = EXCLUDED.finishing_p90,
                shot_generation_stddev             = EXCLUDED.shot_generation_stddev,
                shot_generation_p90                = EXCLUDED.shot_generation_p90,
                chance_creation_stddev             = EXCLUDED.chance_creation_stddev,
                chance_creation_p90                = EXCLUDED.chance_creation_p90,
                carrying_stddev                    = EXCLUDED.carrying_stddev,
                carrying_p90                       = EXCLUDED.carrying_p90,
                duels_stddev                       = EXCLUDED.duels_stddev,
                duels_p90                          = EXCLUDED.duels_p90,
                defensive_stddev                   = EXCLUDED.defensive_stddev,
                defensive_p90                      = EXCLUDED.defensive_p90,
                model_score_stddev                 = EXCLUDED.model_score_stddev,
                model_score_p90                    = EXCLUDED.model_score_p90,
                consistency_score                  = EXCLUDED.consistency_score,
                impact_rate                        = EXCLUDED.impact_rate,
                aerial_win_rate_percentile         = EXCLUDED.aerial_win_rate_percentile,
                ground_duel_win_rate_percentile    = EXCLUDED.ground_duel_win_rate_percentile
            """,
            p,
        )
        upserted += 1

    log.info(f"[{position_label}] Upserted {upserted} peer_rating records")


def compute_cross_league_ratings(db: DB) -> None:
    """
    Cross-league ratings for ST/CF — compares all top-5 league strikers on the
    same z-score scale within a season.

    Reads peer_ratings (already computed per-league), normalizes the 7 v7
    dimension norm averages into z-scores across the full cross-league ST
    sample, then upserts into cross_league_ratings.
    """
    log.info("[cross-league] Computing cross-league ST ratings")

    rows = db.query(
        """
        SELECT
            pr.player_id,
            pr.league_id,
            pr.season,
            pr.minutes_played,
            pr.avg_match_rating,
            mr_agg.avg_finishing_norm,
            mr_agg.avg_shot_generation_norm,
            mr_agg.avg_chance_creation_norm,
            mr_agg.avg_team_function_norm,
            mr_agg.avg_carrying_norm,
            mr_agg.avg_duels_norm,
            mr_agg.avg_defensive_norm
        FROM peer_ratings pr
        JOIN (
            SELECT
                mr.player_id,
                mat.season,
                ROUND(AVG(mr.finishing_norm)::numeric, 4)        AS avg_finishing_norm,
                ROUND(AVG(mr.shot_generation_norm)::numeric, 4)  AS avg_shot_generation_norm,
                ROUND(AVG(mr.chance_creation_norm)::numeric, 4)  AS avg_chance_creation_norm,
                ROUND(AVG(mr.team_function_norm)::numeric, 4)    AS avg_team_function_norm,
                ROUND(AVG(mr.carrying_norm)::numeric, 4)         AS avg_carrying_norm,
                ROUND(AVG(mr.duels_norm)::numeric, 4)            AS avg_duels_norm,
                ROUND(AVG(mr.defensive_norm)::numeric, 4)        AS avg_defensive_norm
            FROM match_ratings mr
            JOIN matches mat ON mat.id = mr.match_id
            WHERE mr.position = 'ST'
            GROUP BY mr.player_id, mat.season
        ) mr_agg ON mr_agg.player_id = pr.player_id AND mr_agg.season = pr.season
        WHERE pr.position = 'ST'
          AND pr.minutes_played >= 300
        """
    )

    if not rows:
        log.info("[cross-league] No ST rows found, skipping")
        return

    # Group by season — z-scores are within-season cross-league
    by_season: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        by_season[r["season"]].append(r)

    dims = [
        "avg_finishing_norm",
        "avg_shot_generation_norm",
        "avg_chance_creation_norm",
        "avg_team_function_norm",
        "avg_carrying_norm",
        "avg_duels_norm",
        "avg_defensive_norm",
    ]
    dim_z_keys = [
        "finishing_z",
        "shot_generation_z",
        "chance_creation_z",
        "team_function_z",
        "carrying_z",
        "duels_z",
        "defensive_z",
    ]
    weights = [0.25, 0.20, 0.15, 0.10, 0.10, 0.15, 0.05]

    upserted = 0
    for season, group in by_season.items():
        for dim, z_key in zip(dims, dim_z_keys):
            vals_list = [float(p[dim] or 0) for p in group]
            if len(vals_list) < 2:
                for p in group:
                    p[z_key] = 0.0
                continue
            mean = statistics.mean(vals_list)
            stdev = statistics.stdev(vals_list)
            for p in group:
                p[z_key] = round((float(p[dim] or 0) - mean) / stdev, 3) if stdev else 0.0

        # Composite score: weighted z-score, scaled to 0-100
        composite_vals = [
            sum(w * p[z] for w, z in zip(weights, dim_z_keys))
            for p in group
        ]
        # Scale: min possible z-score combo → 0, max → 100
        c_min = min(composite_vals)
        c_max = max(composite_vals)
        c_range = c_max - c_min if c_max != c_min else 1.0

        for p, composite in zip(group, composite_vals):
            p["composite_score"] = round((composite - c_min) / c_range * 100, 2)

        # Rank within season (1 = best)
        ranked = sorted(group, key=lambda x: x["composite_score"], reverse=True)
        for rank, p in enumerate(ranked, start=1):
            p["cross_league_rank"] = rank

        for p in group:
            db.execute(
                """
                INSERT INTO cross_league_ratings (
                    player_id, season, position, league_id,
                    finishing_z, shot_generation_z, chance_creation_z,
                    team_function_z, carrying_z, duels_z, defensive_z,
                    composite_score, cross_league_rank, computed_at
                ) VALUES (
                    %(player_id)s, %(season)s, 'ST', %(league_id)s,
                    %(finishing_z)s, %(shot_generation_z)s, %(chance_creation_z)s,
                    %(team_function_z)s, %(carrying_z)s, %(duels_z)s, %(defensive_z)s,
                    %(composite_score)s, %(cross_league_rank)s, NOW()
                )
                ON CONFLICT (player_id, season) DO UPDATE SET
                    league_id           = EXCLUDED.league_id,
                    finishing_z         = EXCLUDED.finishing_z,
                    shot_generation_z   = EXCLUDED.shot_generation_z,
                    chance_creation_z   = EXCLUDED.chance_creation_z,
                    team_function_z     = EXCLUDED.team_function_z,
                    carrying_z          = EXCLUDED.carrying_z,
                    duels_z             = EXCLUDED.duels_z,
                    defensive_z         = EXCLUDED.defensive_z,
                    composite_score     = EXCLUDED.composite_score,
                    cross_league_rank   = EXCLUDED.cross_league_rank,
                    computed_at         = EXCLUDED.computed_at
                """,
                p,
            )
            upserted += 1

    log.info(f"[cross-league] Upserted {upserted} cross_league_ratings records")


def main():
    log.info("Starting Know Ball compute (all positions)")
    db = DB()
    for profile_positions, rating_position, label in POSITION_GROUPS:
        compute_peer_ratings(db, profile_positions, rating_position, label)
    compute_cross_league_ratings(db)
    db.close()
    log.info("Compute complete")


if __name__ == "__main__":
    main()
