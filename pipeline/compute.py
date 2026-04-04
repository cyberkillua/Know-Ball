"""
ST Percentile Aggregator.

Computes season-level aggregated stats and percentile ranks for all ST players.
Runs after rate.py and populates peer_ratings with per-90 metrics and percentiles.

Designed to run after rate.py in the daily pipeline.
"""

from pipeline.db import DB
from pipeline.logger import get_logger

log = get_logger("compute")

MIN_MINUTES = 300


def percentile_of(value: float, all_values: list[float]) -> int:
    """Return the 0-100 percentile rank of value within all_values (higher = better)."""
    if not all_values:
        return 0
    below = sum(1 for v in all_values if v < value)
    equal = sum(1 for v in all_values if v == value)
    # Midpoint method: count all below + half of equals
    pct = (below + 0.5 * equal) / len(all_values) * 100
    return round(pct)


def compute_st_peer_ratings(db: DB, league_scope: str = "league") -> None:
    """
    Compute and upsert peer_ratings for all ST players.

    league_scope: 'league' uses (league_id, season) groups for percentiles.
                  'all' uses season-only groups (cross-league).
    This function always computes league-scoped percentiles (stored in peer_ratings).
    Cross-league percentiles are computed at query time in the frontend toggle.
    """
    # ── Aggregation A: Stats from all apps (profile position filter only) ──────
    log.info("Fetching ST stats (all apps, profile position filter)")

    stat_rows = db.query("""
        SELECT
            mps.player_id,
            mat.league_id,
            mat.season,

            COUNT(DISTINCT mps.match_id)::int                    AS matches_played,
            SUM(mps.minutes_played)::int                         AS minutes_played,

            -- Raw season totals (for raw percentiles)
            SUM(mps.goals)::int                                  AS goals_total,
            ROUND(SUM(mps.xg)::numeric, 3)                      AS xg_total,
            ROUND(SUM(mps.xa)::numeric, 3)                      AS xa_total,
            ROUND(SUM(mps.xgot)::numeric, 3)                    AS xgot_total,
            SUM(mps.shots_total)::int                            AS shots_total,
            SUM(mps.shots_on_target)::int                        AS shots_on_target,
            SUM(mps.assists)::int                                AS assists_total,
            SUM(mps.successful_dribbles)::int                    AS dribbles_successful,
            SUM(mps.failed_dribbles)::int                        AS dribbles_failed,
            SUM(mps.aerial_duels_won)::int                       AS aerial_won,
            SUM(mps.aerial_duels_lost)::int                      AS aerial_lost,
            SUM(mps.ground_duels_won)::int                       AS ground_duels_won,
            SUM(mps.ground_duels_lost)::int                      AS ground_duels_lost,
            SUM(mps.tackles_won)::int                            AS tackles_total,
            SUM(mps.big_chance_created)::int                     AS big_chances_created,
            SUM(mps.big_chance_missed)::int                      AS big_chances_missed,
            SUM(mps.ball_recovery)::int                          AS ball_recoveries,
            SUM(mps.key_passes)::int                             AS key_passes_total,
            SUM(mps.accurate_cross)::int                         AS accurate_cross_total,
            SUM(mps.fouls_won)::int                              AS fouls_won_total,
            SUM(mps.touches)::int                                AS touches_total,
            SUM(mps.interceptions)::int                          AS interceptions_total,
            SUM(mps.fouls_committed)::int                        AS fouls_committed_total,
            (SUM(mps.goals) - SUM(mps.penalty_goals))::int      AS np_goals_total,
            ROUND(SUM(mps.np_xg)::numeric, 4)                   AS np_xg_total,
            SUM(mps.np_shots)::int                               AS np_shots_total
        FROM match_player_stats mps
        JOIN matches mat ON mat.id = mps.match_id
        JOIN players p ON p.id = mps.player_id
        WHERE p.position = 'ST'
        GROUP BY mps.player_id, mat.league_id, mat.season
    """)

    if not stat_rows:
        log.info("No ST records found, nothing to compute")
        return

    log.info(f"Found {len(stat_rows)} player-league-season groups (stats)")

    # ── Aggregation B: Norms from matches rated as ST ────────────────────────
    log.info("Fetching ST norms (rated matches only)")

    norm_rows = db.query("""
        SELECT
            mr.player_id,
            mat.league_id,
            mat.season,
            SUM(mps.minutes_played)::int                         AS rated_minutes,
            ROUND(AVG(mr.final_rating)::numeric, 2)              AS avg_match_rating,
            ROUND(AVG(mr.finishing_norm)::numeric, 4)            AS avg_finishing_norm,
            ROUND(AVG(mr.involvement_norm)::numeric, 4)          AS avg_involvement_norm,
            ROUND(AVG(mr.carrying_norm)::numeric, 4)             AS avg_carrying_norm,
            ROUND(AVG(mr.physical_norm)::numeric, 4)             AS avg_physical_norm,
            ROUND(AVG(mr.pressing_norm)::numeric, 4)             AS avg_pressing_norm
        FROM match_ratings mr
        JOIN matches mat ON mat.id = mr.match_id
        JOIN match_player_stats mps ON mps.match_id = mr.match_id AND mps.player_id = mr.player_id
        JOIN players p ON p.id = mr.player_id
        WHERE mr.position = 'ST'
          AND p.position = 'ST'
        GROUP BY mr.player_id, mat.league_id, mat.season
    """)

    # Build lookup: (player_id, league_id, season) -> norm data
    norm_lookup: dict[tuple, dict] = {
        (r["player_id"], r["league_id"], r["season"]): r for r in norm_rows
    }

    log.info(f"Found {len(norm_rows)} player-league-season groups (norms)")

    # Compute derived stats for each player
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

        norm = norm_lookup.get((r["player_id"], r["league_id"], r["season"]), {})
        rated_minutes = norm.get("rated_minutes") or 0

        p = {
            "player_id": r["player_id"],
            "league_id": r["league_id"],
            "season": r["season"],
            "position": "ST",
            "matches_played": r["matches_played"],
            "minutes_played": minutes,
            "rated_minutes": rated_minutes,
            "avg_match_rating": float(norm.get("avg_match_rating") or 0),
            # Per-90s (stored for display / existing columns)
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
            # New derived stats
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
            # Non-penalty stats
            "np_goals_per90": round(np_goals / per90, 2),
            "np_xg_per90": round(np_xg / per90, 2),
            "np_xg_per_shot": round(np_xg / max(np_shots, 1), 3),
            "np_goals_raw": np_goals,
            "np_xg_raw": np_xg,
            # Raw totals for raw percentiles
            "_np_goals_raw": np_goals,
            "_np_xg_raw": np_xg,
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
            "_total_contests_raw": aerial_won + aerial_lost + ground_won + ground_lost,
            "_tackles_raw": tackles,
            "_interceptions_raw": interceptions,
            "_ball_recoveries_raw": recoveries,
            "_fouls_committed_raw": fouls_committed,
            # Category norms from rated matches only (Peer comparison)
            "_avg_finishing_norm": float(norm.get("avg_finishing_norm") or 0),
            "_avg_involvement_norm": float(norm.get("avg_involvement_norm") or 0),
            "_avg_carrying_norm": float(norm.get("avg_carrying_norm") or 0),
            "_avg_physical_norm": float(norm.get("avg_physical_norm") or 0),
            "_avg_pressing_norm": float(norm.get("avg_pressing_norm") or 0),
        }
        players.append(p)

    # Group by (league_id, season) for percentile ranking
    from collections import defaultdict

    groups: dict[tuple, list[dict]] = defaultdict(list)
    for p in players:
        groups[(p["league_id"], p["season"])].append(p)

    # Within each group, compute percentiles for qualified players (>= MIN_MINUTES)
    for (league_id, season), group in groups.items():
        qualified = [p for p in group if p["minutes_played"] >= MIN_MINUTES]
        if not qualified:
            # Set all percentiles to NULL for unqualified groups
            for p in group:
                for col in (
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
                    # Additional per-90 percentiles
                    "dribbles_per90_percentile",
                    "touches_per90_percentile",
                    "fouls_won_per90_percentile",
                    "aerials_per90_percentile",
                    "ground_duels_won_per90_percentile",
                    "total_contest_per90_percentile",
                    "tackles_per90_percentile",
                    "interceptions_per90_percentile",
                    "ball_recoveries_per90_percentile",
                    # Raw percentiles
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
                ):
                    p[col] = None
            continue

        # Build value lists for each rankable metric (from qualified players only)
        def vals(key: str) -> list[float]:
            return [float(p[key]) for p in qualified]

        finishing_vals = vals("_avg_finishing_norm")
        involvement_vals = vals("_avg_involvement_norm")
        carrying_vals = vals("_avg_carrying_norm")
        physical_vals = vals("_avg_physical_norm")
        pressing_vals = vals("_avg_pressing_norm")
        overall_vals = [
            0.3 * p["_avg_finishing_norm"]
            + 0.225 * p["_avg_involvement_norm"]
            + 0.175 * p["_avg_carrying_norm"]
            + 0.175 * p["_avg_physical_norm"]
            + 0.125 * p["_avg_pressing_norm"]
            for p in qualified
        ]
        goals_per90_vals = vals("goals_per90")
        shots_per90_vals = vals("shots_per90")
        xg_per90_vals = vals("xg_per90")
        xgot_per90_vals = vals("xgot_per90")
        xg_per_shot_vals = vals("xg_per_shot")
        sot_rate_vals = vals("shot_on_target_rate")
        xg_xa_vals = vals("xg_plus_xa_per90")
        overperf_vals = vals("xg_overperformance")
        drib_rate_vals = vals("dribble_success_rate")
        conversion_vals = vals("shot_conversion_rate")
        bcc_vals = vals("big_chances_created_per90")
        bcm_vals = vals("big_chances_missed_per90")
        xa_vals = vals("xa_per90")
        assists_vals = vals("assists_per90")
        key_passes_vals = vals("key_passes_per90")
        accurate_cross_vals = vals("accurate_cross_per90")
        # Additional per-90 value lists
        dribbles_per90_vals = vals("dribbles_per90")
        touches_per90_vals = vals("touches_per90")
        fouls_won_per90_vals = vals("fouls_won_per90")
        aerials_per90_vals = vals("aerial_wins_per90")
        ground_duels_won_per90_vals = vals("ground_duels_won_per90")
        total_contest_per90_vals = vals("total_contest_per90")
        tackles_per90_vals = vals("tackles_per90")
        interceptions_per90_vals = vals("interceptions_per90")
        ball_recoveries_per90_vals = vals("ball_recovery_per90")

        # Raw value lists
        goals_raw_vals = vals("_goals_raw")
        assists_raw_vals = vals("_assists_raw")
        shots_raw_vals = vals("_shots_raw")
        xg_raw_vals = vals("_xg_raw")
        xa_raw_vals = vals("_xa_raw")
        key_passes_raw_vals = vals("_key_passes_raw")
        bcc_raw_vals = vals("_big_chances_created_raw")
        bcm_raw_vals = vals("_big_chances_missed_raw")
        accurate_cross_raw_vals = vals("_accurate_cross_raw")
        dribbles_raw_vals = vals("_dribbles_raw")
        fouls_won_raw_vals = vals("_fouls_won_raw")
        touches_raw_vals = vals("_touches_raw")
        aerials_won_raw_vals = vals("_aerials_won_raw")
        ground_duels_won_raw_vals = vals("_ground_duels_won_raw")
        total_contests_raw_vals = vals("_total_contests_raw")
        tackles_raw_vals = vals("_tackles_raw")
        interceptions_raw_vals = vals("_interceptions_raw")
        ball_recoveries_raw_vals = vals("_ball_recoveries_raw")
        fouls_committed_raw_vals = vals("_fouls_committed_raw")
        np_goals_per90_vals = vals("np_goals_per90")
        np_xg_per90_vals = vals("np_xg_per90")
        np_xg_per_shot_vals = vals("np_xg_per_shot")
        np_goals_raw_vals = vals("_np_goals_raw")
        np_xg_raw_vals = vals("_np_xg_raw")

        for p in qualified:
            overall_score = (
                0.3 * p["_avg_finishing_norm"]
                + 0.225 * p["_avg_involvement_norm"]
                + 0.175 * p["_avg_carrying_norm"]
                + 0.175 * p["_avg_physical_norm"]
                + 0.125 * p["_avg_pressing_norm"]
            )
            # Per-90 percentiles
            p["goals_per90_percentile"] = percentile_of(
                p["goals_per90"], goals_per90_vals
            )
            p["shots_per90_percentile"] = percentile_of(
                p["shots_per90"], shots_per90_vals
            )
            p["finishing_percentile"] = percentile_of(
                p["_avg_finishing_norm"], finishing_vals
            )
            p["involvement_percentile"] = percentile_of(
                p["_avg_involvement_norm"], involvement_vals
            )
            p["carrying_percentile"] = percentile_of(
                p["_avg_carrying_norm"], carrying_vals
            )
            p["physical_percentile"] = percentile_of(
                p["_avg_physical_norm"], physical_vals
            )
            p["pressing_percentile"] = percentile_of(
                p["_avg_pressing_norm"], pressing_vals
            )
            p["overall_percentile"] = percentile_of(overall_score, overall_vals)
            p["xg_plus_xa_percentile"] = percentile_of(
                p["xg_plus_xa_per90"], xg_xa_vals
            )
            p["xg_overperformance_percentile"] = percentile_of(
                p["xg_overperformance"], overperf_vals
            )
            p["dribble_success_percentile"] = percentile_of(
                p["dribble_success_rate"], drib_rate_vals
            )
            p["shot_conversion_percentile"] = percentile_of(
                p["shot_conversion_rate"], conversion_vals
            )
            p["big_chances_created_percentile"] = percentile_of(
                p["big_chances_created_per90"], bcc_vals
            )
            p["xg_per90_percentile"] = percentile_of(p["xg_per90"], xg_per90_vals)
            p["xgot_per90_percentile"] = percentile_of(p["xgot_per90"], xgot_per90_vals)
            p["xg_per_shot_percentile"] = percentile_of(
                p["xg_per_shot"], xg_per_shot_vals
            )
            p["shot_on_target_percentile"] = percentile_of(
                p["shot_on_target_rate"], sot_rate_vals
            )
            p["big_chances_missed_percentile"] = 100 - percentile_of(
                p["big_chances_missed_per90"], bcm_vals
            )
            p["xa_per90_percentile"] = percentile_of(p["xa_per90"], xa_vals)
            p["assists_per90_percentile"] = percentile_of(
                p["assists_per90"], assists_vals
            )
            p["key_passes_per90_percentile"] = percentile_of(
                p["key_passes_per90"], key_passes_vals
            )
            p["accurate_cross_per90_percentile"] = percentile_of(
                p["accurate_cross_per90"], accurate_cross_vals
            )
            # Additional per-90 percentiles
            p["dribbles_per90_percentile"] = percentile_of(
                p["dribbles_per90"], dribbles_per90_vals
            )
            p["touches_per90_percentile"] = percentile_of(
                p["touches_per90"], touches_per90_vals
            )
            p["fouls_won_per90_percentile"] = percentile_of(
                p["fouls_won_per90"], fouls_won_per90_vals
            )
            p["aerials_per90_percentile"] = percentile_of(
                p["aerial_wins_per90"], aerials_per90_vals
            )
            p["ground_duels_won_per90_percentile"] = percentile_of(
                p["ground_duels_won_per90"], ground_duels_won_per90_vals
            )
            p["total_contest_per90_percentile"] = percentile_of(
                p["total_contest_per90"], total_contest_per90_vals
            )
            p["tackles_per90_percentile"] = percentile_of(
                p["tackles_per90"], tackles_per90_vals
            )
            p["interceptions_per90_percentile"] = percentile_of(
                p["interceptions_per90"], interceptions_per90_vals
            )
            p["ball_recoveries_per90_percentile"] = percentile_of(
                p["ball_recovery_per90"], ball_recoveries_per90_vals
            )

            # Raw percentiles
            p["goals_raw_percentile"] = percentile_of(p["_goals_raw"], goals_raw_vals)
            p["assists_raw_percentile"] = percentile_of(
                p["_assists_raw"], assists_raw_vals
            )
            p["shots_raw_percentile"] = percentile_of(p["_shots_raw"], shots_raw_vals)
            p["xg_raw_percentile"] = percentile_of(p["_xg_raw"], xg_raw_vals)
            p["xa_raw_percentile"] = percentile_of(p["_xa_raw"], xa_raw_vals)
            p["key_passes_raw_percentile"] = percentile_of(
                p["_key_passes_raw"], key_passes_raw_vals
            )
            p["big_chances_created_raw_percentile"] = percentile_of(
                p["_big_chances_created_raw"], bcc_raw_vals
            )
            p["big_chances_missed_raw_percentile"] = 100 - percentile_of(
                p["_big_chances_missed_raw"], bcm_raw_vals
            )
            p["accurate_cross_raw_percentile"] = percentile_of(
                p["_accurate_cross_raw"], accurate_cross_raw_vals
            )
            p["dribbles_raw_percentile"] = percentile_of(
                p["_dribbles_raw"], dribbles_raw_vals
            )
            p["fouls_won_raw_percentile"] = percentile_of(
                p["_fouls_won_raw"], fouls_won_raw_vals
            )
            p["touches_raw_percentile"] = percentile_of(
                p["_touches_raw"], touches_raw_vals
            )
            p["aerials_won_raw_percentile"] = percentile_of(
                p["_aerials_won_raw"], aerials_won_raw_vals
            )
            p["ground_duels_won_raw_percentile"] = percentile_of(
                p["_ground_duels_won_raw"], ground_duels_won_raw_vals
            )
            p["total_contests_raw_percentile"] = percentile_of(
                p["_total_contests_raw"], total_contests_raw_vals
            )
            p["tackles_raw_percentile"] = percentile_of(
                p["_tackles_raw"], tackles_raw_vals
            )
            p["interceptions_raw_percentile"] = percentile_of(
                p["_interceptions_raw"], interceptions_raw_vals
            )
            p["ball_recoveries_raw_percentile"] = percentile_of(
                p["_ball_recoveries_raw"], ball_recoveries_raw_vals
            )
            # Fouls committed: lower is better, so invert
            p["fouls_committed_raw_percentile"] = 100 - percentile_of(
                p["_fouls_committed_raw"], fouls_committed_raw_vals
            )
            # Non-penalty percentiles
            p["np_goals_per90_percentile"] = percentile_of(p["np_goals_per90"], np_goals_per90_vals)
            p["np_xg_per90_percentile"] = percentile_of(p["np_xg_per90"], np_xg_per90_vals)
            p["np_xg_per_shot_percentile"] = percentile_of(p["np_xg_per_shot"], np_xg_per_shot_vals)
            p["np_goals_raw_percentile"] = percentile_of(p["_np_goals_raw"], np_goals_raw_vals)
            p["np_xg_raw_percentile"] = percentile_of(p["_np_xg_raw"], np_xg_raw_vals)

        # Unqualified players get NULL percentiles
        for p in group:
            if p["minutes_played"] < MIN_MINUTES:
                for col in (
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
                    # Additional per-90 percentiles
                    "dribbles_per90_percentile",
                    "touches_per90_percentile",
                    "fouls_won_per90_percentile",
                    "aerials_per90_percentile",
                    "ground_duels_won_per90_percentile",
                    "total_contest_per90_percentile",
                    "tackles_per90_percentile",
                    "interceptions_per90_percentile",
                    "ball_recoveries_per90_percentile",
                    # Raw percentiles
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
                ):
                    p[col] = None

    # Upsert all records into peer_ratings
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
                np_goals_raw_percentile, np_xg_raw_percentile
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
                %(np_goals_raw_percentile)s, %(np_xg_raw_percentile)s
            )
            ON CONFLICT (player_id, league_id, season) DO UPDATE SET
                position                        = EXCLUDED.position,
                matches_played                  = EXCLUDED.matches_played,
                minutes_played                  = EXCLUDED.minutes_played,
                rated_minutes                   = EXCLUDED.rated_minutes,
                avg_match_rating                = EXCLUDED.avg_match_rating,
                goals_per90                     = EXCLUDED.goals_per90,
                xg_per90                        = EXCLUDED.xg_per90,
                xgot_per90                      = EXCLUDED.xgot_per90,
                shots_per90                     = EXCLUDED.shots_per90,
                xa_per90                        = EXCLUDED.xa_per90,
                assists_per90                   = EXCLUDED.assists_per90,
                key_passes_per90                = EXCLUDED.key_passes_per90,
                accurate_cross_per90            = EXCLUDED.accurate_cross_per90,
                dribbles_per90                  = EXCLUDED.dribbles_per90,
                aerial_wins_per90               = EXCLUDED.aerial_wins_per90,
                tackles_per90                   = EXCLUDED.tackles_per90,
                xg_plus_xa_per90                = EXCLUDED.xg_plus_xa_per90,
                xg_overperformance              = EXCLUDED.xg_overperformance,
                dribble_success_rate            = EXCLUDED.dribble_success_rate,
                big_chances_created_per90       = EXCLUDED.big_chances_created_per90,
                big_chances_missed_per90        = EXCLUDED.big_chances_missed_per90,
                shot_conversion_rate            = EXCLUDED.shot_conversion_rate,
                shot_on_target_rate             = EXCLUDED.shot_on_target_rate,
                ball_recovery_per90             = EXCLUDED.ball_recovery_per90,
                xg_per_shot                     = EXCLUDED.xg_per_shot,
                goals_per90_percentile          = EXCLUDED.goals_per90_percentile,
                shots_per90_percentile          = EXCLUDED.shots_per90_percentile,
                xg_per90_percentile             = EXCLUDED.xg_per90_percentile,
                xgot_per90_percentile           = EXCLUDED.xgot_per90_percentile,
                xg_per_shot_percentile          = EXCLUDED.xg_per_shot_percentile,
                shot_on_target_percentile       = EXCLUDED.shot_on_target_percentile,
                big_chances_missed_percentile   = EXCLUDED.big_chances_missed_percentile,
                finishing_percentile            = EXCLUDED.finishing_percentile,
                involvement_percentile          = EXCLUDED.involvement_percentile,
                carrying_percentile             = EXCLUDED.carrying_percentile,
                physical_percentile             = EXCLUDED.physical_percentile,
                pressing_percentile             = EXCLUDED.pressing_percentile,
                overall_percentile              = EXCLUDED.overall_percentile,
                xg_plus_xa_percentile           = EXCLUDED.xg_plus_xa_percentile,
                xg_overperformance_percentile   = EXCLUDED.xg_overperformance_percentile,
                dribble_success_percentile      = EXCLUDED.dribble_success_percentile,
                shot_conversion_percentile      = EXCLUDED.shot_conversion_percentile,
                big_chances_created_percentile  = EXCLUDED.big_chances_created_percentile,
                xa_per90_percentile             = EXCLUDED.xa_per90_percentile,
                assists_per90_percentile        = EXCLUDED.assists_per90_percentile,
                key_passes_per90_percentile     = EXCLUDED.key_passes_per90_percentile,
                accurate_cross_per90_percentile = EXCLUDED.accurate_cross_per90_percentile,
                dribbles_per90_percentile       = EXCLUDED.dribbles_per90_percentile,
                touches_per90_percentile        = EXCLUDED.touches_per90_percentile,
                fouls_won_per90_percentile      = EXCLUDED.fouls_won_per90_percentile,
                aerials_per90_percentile        = EXCLUDED.aerials_per90_percentile,
                ground_duels_won_per90_percentile = EXCLUDED.ground_duels_won_per90_percentile,
                total_contest_per90_percentile  = EXCLUDED.total_contest_per90_percentile,
                tackles_per90_percentile        = EXCLUDED.tackles_per90_percentile,
                interceptions_per90_percentile  = EXCLUDED.interceptions_per90_percentile,
                ball_recoveries_per90_percentile = EXCLUDED.ball_recoveries_per90_percentile,
                goals_raw_percentile            = EXCLUDED.goals_raw_percentile,
                assists_raw_percentile          = EXCLUDED.assists_raw_percentile,
                shots_raw_percentile            = EXCLUDED.shots_raw_percentile,
                xg_raw_percentile               = EXCLUDED.xg_raw_percentile,
                xa_raw_percentile               = EXCLUDED.xa_raw_percentile,
                key_passes_raw_percentile       = EXCLUDED.key_passes_raw_percentile,
                big_chances_created_raw_percentile = EXCLUDED.big_chances_created_raw_percentile,
                big_chances_missed_raw_percentile = EXCLUDED.big_chances_missed_raw_percentile,
                accurate_cross_raw_percentile   = EXCLUDED.accurate_cross_raw_percentile,
                dribbles_raw_percentile         = EXCLUDED.dribbles_raw_percentile,
                fouls_won_raw_percentile        = EXCLUDED.fouls_won_raw_percentile,
                touches_raw_percentile          = EXCLUDED.touches_raw_percentile,
                aerials_won_raw_percentile      = EXCLUDED.aerials_won_raw_percentile,
                ground_duels_won_raw_percentile = EXCLUDED.ground_duels_won_raw_percentile,
                total_contests_raw_percentile   = EXCLUDED.total_contests_raw_percentile,
                tackles_raw_percentile         = EXCLUDED.tackles_raw_percentile,
                interceptions_raw_percentile    = EXCLUDED.interceptions_raw_percentile,
                ball_recoveries_raw_percentile  = EXCLUDED.ball_recoveries_raw_percentile,
                fouls_committed_raw_percentile  = EXCLUDED.fouls_committed_raw_percentile,
                np_goals_per90                  = EXCLUDED.np_goals_per90,
                np_xg_per90                     = EXCLUDED.np_xg_per90,
                np_xg_per_shot                  = EXCLUDED.np_xg_per_shot,
                np_goals_raw                    = EXCLUDED.np_goals_raw,
                np_xg_raw                       = EXCLUDED.np_xg_raw,
                np_goals_per90_percentile       = EXCLUDED.np_goals_per90_percentile,
                np_xg_per90_percentile          = EXCLUDED.np_xg_per90_percentile,
                np_xg_per_shot_percentile       = EXCLUDED.np_xg_per_shot_percentile,
                np_goals_raw_percentile         = EXCLUDED.np_goals_raw_percentile,
                np_xg_raw_percentile            = EXCLUDED.np_xg_raw_percentile
        """,
            p,
        )
        upserted += 1

    log.info(f"Upserted {upserted} peer_rating records")


def main():
    log.info("Starting Know Ball compute (ST percentiles)")
    db = DB()
    compute_st_peer_ratings(db)
    db.close()
    log.info("Compute complete")


if __name__ == "__main__":
    main()
