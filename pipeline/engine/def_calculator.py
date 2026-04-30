"""
Centre-back / defender match rating calculator.

The current data is event-boxscore based, so the model scores observable CB
actions and proxies: box defending, anticipation, duels, recovery, composure,
build-up value, and set-piece/goal threat.
"""

from dataclasses import dataclass

from pipeline.engine.calculator import PlayerMatchStats, normalize_score


@dataclass
class DEFCategoryScores:
    defensive_raw: float = 0.0
    duels_raw: float = 0.0
    carrying_raw: float = 0.0
    team_function_raw: float = 0.0
    volume_passing_raw: float = 0.0
    goal_threat_raw: float = 0.0
    defensive_norm: float = 0.0
    duels_norm: float = 0.0
    carrying_norm: float = 0.0
    team_function_norm: float = 0.0
    volume_passing_norm: float = 0.0
    goal_threat_norm: float = 0.0


def calc_defensive(stats: PlayerMatchStats, constants: dict) -> float:
    """Box defending and anticipation."""
    c = constants
    return (
        stats.clearances * c.get("clearance_reward", 0.045)
        + stats.outfielder_block * c.get("block_reward", 0.12)
        + stats.interceptions * c.get("interception_reward", 0.12)
        + stats.ball_recovery * c.get("recovery_reward", 0.06)
        + stats.tackles_won * c.get("tackle_reward", 0.08)
    )


def calc_duels(stats: PlayerMatchStats, constants: dict) -> float:
    """Aerial and ground duel security."""
    c = constants
    total_duels = (
        stats.aerial_duels_won
        + stats.aerial_duels_lost
        + stats.ground_duels_won
        + stats.ground_duels_lost
    )
    return (
        stats.aerial_duels_won * c.get("aerial_win_reward", 0.1)
        - stats.aerial_duels_lost * c.get("aerial_loss_penalty", 0.05)
        + stats.ground_duels_won * c.get("ground_duel_win_reward", 0.08)
        - stats.ground_duels_lost * c.get("ground_duel_loss_penalty", 0.05)
        + total_duels * c.get("duel_volume_reward", 0.002)
    )


def calc_carrying(stats: PlayerMatchStats, constants: dict) -> float:
    """Recovery/mobility proxy plus low-risk carrying."""
    c = constants
    possession_loss_rate = stats.possession_lost_ctrl / max(stats.touches, 1)
    recovery_actions = stats.ball_recovery + stats.ground_duels_won
    return (
        recovery_actions * c.get("mobility_action_reward", 0.035)
        + stats.total_progressive_ball_carries_distance
        * c.get("progressive_carry_distance_weight", 0.0012)
        - possession_loss_rate * c.get("possession_loss_rate_penalty", 0.18)
    )


def calc_team_function(stats: PlayerMatchStats, constants: dict) -> float:
    """Composure under pressure: pass security, involvement, and mistake control."""
    c = constants
    pass_acc = stats.passes_completed / max(stats.passes_total, 1)
    pass_delta = max(0.0, pass_acc - c.get("pass_accuracy_threshold", 0.78))
    possession_loss_rate = stats.possession_lost_ctrl / max(stats.touches, 1)
    return (
        pass_delta * c.get("pass_accuracy_weight", 0.55)
        + stats.touches * c.get("presence_factor", 0.0015)
        - possession_loss_rate * c.get("possession_loss_rate_penalty", 0.18)
        - stats.error_lead_to_shot * c.get("error_lead_to_shot_penalty", 0.35)
    )


def calc_volume_passing(stats: PlayerMatchStats, constants: dict) -> float:
    """Ball-playing CB value."""
    c = constants
    long_ball_accuracy = stats.accurate_long_balls / max(stats.total_long_balls, 1)
    long_ball_acc_lift = 0.0
    if stats.total_long_balls >= c.get("long_ball_accuracy_min_attempts", 3):
        long_ball_acc_lift = max(
            0.0, long_ball_accuracy - c.get("long_ball_accuracy_threshold", 0.48)
        ) * c.get("long_ball_accuracy_weight", 0.18)

    return (
        stats.pass_value_normalized * c.get("pass_value_weight", 0.65)
        + min(stats.accurate_long_balls, c.get("accurate_long_ball_cap", 10))
        * c.get("accurate_long_ball_reward", 0.025)
        + min(
            stats.accurate_opposition_half_passes,
            c.get("opposition_half_pass_cap", 30),
        )
        * c.get("opposition_half_pass_reward", 0.004)
        + long_ball_acc_lift
    )


def calc_goal_threat(stats: PlayerMatchStats, constants: dict) -> float:
    """Set-piece and shot threat, before actual goal conversion."""
    c = constants
    return (
        stats.xg * c.get("xg_volume_weight", 0.25)
        + stats.shots_total * c.get("shot_volume_reward", 0.035)
    )


DEF_CATEGORIES = [
    "defensive",
    "duels",
    "carrying",
    "team_function",
    "volume_passing",
    "goal_threat",
]

_CALC_MAP = {
    "defensive": calc_defensive,
    "duels": calc_duels,
    "carrying": calc_carrying,
    "team_function": calc_team_function,
    "volume_passing": calc_volume_passing,
    "goal_threat": calc_goal_threat,
}


def _is_centre_back(stats: PlayerMatchStats) -> bool:
    pos = (stats.profile_position or "").upper().strip()
    return pos in {"CB", "D", "DEF", "DEFENDER"}


def _calculate_result_lift(stats: PlayerMatchStats, constants: dict) -> float:
    if stats.team_goals_for is None or stats.team_goals_conceded is None:
        return 0.0
    if stats.minutes_played < constants.get("result_context_min_minutes", 45):
        return 0.0
    if stats.team_goals_for > stats.team_goals_conceded:
        return constants.get("win_bonus", 0.04)
    if stats.team_goals_for < stats.team_goals_conceded:
        return -constants.get("loss_penalty", 0.03)
    return constants.get("draw_bonus", 0.0)


def _calculate_cb_context_lift(stats: PlayerMatchStats, constants: dict) -> float:
    """Small team-defense context for CBs; never enough to dominate actions."""
    if not _is_centre_back(stats):
        return 0.0
    if stats.minutes_played < constants.get("cb_context_min_minutes", 60):
        return 0.0

    lift = 0.0
    conceded = stats.team_goals_conceded
    if conceded is not None:
        goals_after_first = max(0, int(conceded) - 1)
        lift -= min(
            goals_after_first * constants.get("goal_conceded_after_first_penalty", 0.04),
            constants.get("goal_conceded_penalty_cap", 0.12),
        )

    xg_against = stats.team_expected_goals_conceded
    if xg_against is not None:
        low_bar = constants.get("low_xg_against_bonus_threshold", 0.7)
        high_bar = constants.get("high_xg_against_penalty_threshold", 1.8)
        if xg_against <= low_bar:
            lift += constants.get("low_xg_against_bonus", 0.04)
        elif xg_against >= high_bar:
            excess = xg_against - high_bar
            lift -= min(
                excess * constants.get("high_xg_against_penalty_weight", 0.04),
                constants.get("high_xg_against_penalty_cap", 0.08),
            )

    big_chances = stats.team_big_chances_conceded
    if big_chances is not None:
        excess_big_chances = max(0, int(big_chances) - 2)
        lift -= min(
            excess_big_chances * constants.get("big_chance_conceded_penalty", 0.025),
            constants.get("big_chance_conceded_penalty_cap", 0.06),
        )

    return lift


def calculate_def_rating(
    stats: PlayerMatchStats,
    config: dict,
) -> tuple[float, DEFCategoryScores]:
    constants = config["constants"]
    weights = config["weights"]
    baseline = config["baseline"]
    midpoints = config.get("normalization", {}).get("midpoints", {})

    scores = DEFCategoryScores()
    weighted = 0.0
    for cat in DEF_CATEGORIES:
        raw = _CALC_MAP[cat](stats, constants)
        setattr(scores, f"{cat}_raw", raw)

        mp = midpoints.get(cat, {})
        norm = normalize_score(raw, mp.get("median", 0.0), mp.get("scale", 1.0))
        setattr(scores, f"{cat}_norm", round(norm, 2))
        weighted += weights.get(cat, 0.0) * norm

    # Goals and assists are post-normalization bonuses, matching the other
    # calculators: they matter, but they are not part of the core CB judgement.
    np_goals = stats.goals - stats.penalty_goals
    goal_lift = np_goals * constants.get(
        "goal_bonus", 0.55
    ) + stats.penalty_goals * constants.get("penalty_goal_bonus", 0.35)
    assist_lift = stats.assists * constants.get("match_assist_lift", 0.35)
    clean_sheet_lift = 0.0
    if (
        stats.team_goals_conceded == 0
        and stats.minutes_played >= constants.get("clean_sheet_min_minutes", 60)
    ):
        clean_sheet_lift = constants.get("clean_sheet_bonus", 0.40)

    final = baseline + weighted
    final += goal_lift
    final += assist_lift
    final += clean_sheet_lift
    final += _calculate_result_lift(stats, constants)
    final += _calculate_cb_context_lift(stats, constants)
    final -= stats.error_lead_to_goal * constants.get("error_lead_to_goal_penalty", 0.65)
    final -= stats.penalty_conceded * constants.get("penalty_conceded_penalty", 0.35)
    final -= stats.own_goals * constants.get("own_goal_penalty", 0.45)
    final += stats.red_cards * constants.get("red_card_penalty", -1.0)
    final += stats.yellow_cards * constants.get("yellow_card_penalty", -0.05)

    return round(max(3.0, min(10.0, final)), 1), scores
