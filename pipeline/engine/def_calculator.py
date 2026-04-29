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
        - stats.error_lead_to_goal * c.get("error_lead_to_goal_penalty", 0.9)
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
    """Set-piece and goal threat."""
    c = constants
    return (
        stats.goals * c.get("goal_bonus", 0.7)
        + stats.xg * c.get("xg_volume_weight", 0.25)
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

    final = baseline + weighted
    final += stats.goals * constants.get("match_goal_lift", 0.25)
    final -= stats.error_lead_to_shot * constants.get("error_lead_to_shot_match_penalty", 0.25)
    final -= stats.error_lead_to_goal * constants.get("error_lead_to_goal_match_penalty", 0.75)
    final += stats.red_cards * constants.get("red_card_penalty", -1.0)
    final += stats.yellow_cards * constants.get("yellow_card_penalty", -0.05)

    return round(max(3.0, min(10.0, final)), 1), scores
