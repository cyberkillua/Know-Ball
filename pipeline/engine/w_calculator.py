"""
Winger (W) Match Rating Calculator.

Calculates per-match player ratings for wingers based on raw stats.
Each category produces a raw score, which is then normalized,
weighted, and combined with the baseline to produce a final rating.

Dimensions: productive_dribbling, chance_creation, goal_contribution,
            carrying, shot_generation, defensive, presence.
"""

from dataclasses import dataclass

from pipeline.engine.calculator import PlayerMatchStats, normalize_score


@dataclass
class WingerCategoryScores:
    """Raw and normalized scores per winger category."""

    productive_dribbling_raw: float = 0.0
    chance_creation_raw: float = 0.0
    goal_contribution_raw: float = 0.0
    carrying_raw: float = 0.0
    shot_generation_raw: float = 0.0
    defensive_raw: float = 0.0
    presence_raw: float = 0.0
    productive_dribbling_norm: float = 0.0
    chance_creation_norm: float = 0.0
    goal_contribution_norm: float = 0.0
    carrying_norm: float = 0.0
    shot_generation_norm: float = 0.0
    defensive_norm: float = 0.0
    presence_norm: float = 0.0


def calc_productive_dribbling(stats: PlayerMatchStats, constants: dict) -> float:
    """
    Productive Dribbling — dribbles that lead to something.

    Rewards dribble completion rate, penalizes failed dribbles,
    and heavily rewards post-dribble shot creation (self_created_shots
    as proxy for dribble -> shot).

    Raw = (dribble_rate - 0.45) * productive_dribble_rate_weight
        + successful_dribbles * dribble_completion_reward
        - failed_dribbles * dribble_fail_penalty
        + self_created_shots * post_dribble_sca_reward
        + dribble_volume * dribble_volume_reward
    """
    c = constants
    dribble_volume = stats.successful_dribbles + stats.failed_dribbles
    dribble_rate = stats.successful_dribbles / max(dribble_volume, 1)

    rate_score = (dribble_rate - 0.45) * c.get("productive_dribble_rate_weight", 0.3)
    completion = stats.successful_dribbles * c.get("dribble_completion_reward", 0.08)
    fail_pen = stats.failed_dribbles * c.get("dribble_fail_penalty", 0.04)
    post_dribble = stats.self_created_shots * c.get("post_dribble_sca_reward", 0.25)
    volume = dribble_volume * c.get("dribble_volume_reward", 0.05)

    return rate_score + completion - fail_pen + post_dribble + volume


def calc_chance_creation(stats: PlayerMatchStats, constants: dict) -> float:
    """
    Chance Creation — output-based quality of chances created for teammates.

    xA is the primary signal (captures crosses, through balls, cutbacks equally).
    Big chances created and key passes layer on top.
    High xA bonus rewards elite creative performances.

    Raw = xa
        + big_chance_created * big_chance_created_reward
        + key_passes * key_pass_reward
        + high_xa_bonus (if xa >= xa_high_threshold)
    """
    c = constants
    xa_value = stats.xa
    big_chances = stats.big_chance_created * c.get("big_chance_created_reward", 0.15)
    key_passes = stats.key_passes * c.get("key_pass_reward", 0.06)

    high_xa = 0.0
    if stats.xa >= c.get("xa_high_threshold", 0.25):
        high_xa = c.get("high_xa_bonus", 0.2)

    return xa_value + big_chances + key_passes + high_xa


def calc_goal_contribution(stats: PlayerMatchStats, constants: dict) -> float:
    """
    Goal Contribution — finishing quality and xG generation.

    Uses per-shot finishing_score (sum of goal - xG from shots table)
    plus xG volume to measure overall goal threat.
    Bonus for outperforming xG (clinical finishing).

    Raw = finishing_score
        + xg * xg_volume_weight
        + xg_overperformance_bonus (if np_goals > xg)
    """
    c = constants
    finishing = stats.finishing_score if stats.shots_total > 0 else 0.0
    xg_volume = stats.xg * c.get("xg_volume_weight", 0.3)

    xg_over = 0.0
    np_goals = stats.goals - stats.penalty_goals
    if np_goals > 0 and stats.xg > 0 and np_goals > stats.xg:
        xg_over = c.get("xg_overperformance_bonus", 0.3)

    return finishing + xg_volume + xg_over


def calc_carrying(stats: PlayerMatchStats, constants: dict) -> float:
    """
    Carrying & Ball Retention.

    Possession retention and ball progression. Progressive carry and
    carry distance are placeholders (set to 0) until a data source is added.

    Raw = progressive_carry (placeholder 0)
        + carry_distance (placeholder 0)
        + fouls_won * foul_won_reward
        + penalty_won * penalty_won_reward
        - possession_loss_rate * possession_loss_rate_penalty
        - error_lead_to_goal * error_lead_to_goal_penalty
    """
    c = constants

    # Placeholders — will activate when data source is available
    # progressive = progressive_carries * c.get("progressive_carry_reward", 0.0)
    # carry_dist = carry_distance * c.get("carry_distance_weight", 0.0)

    fouls = stats.fouls_won * c.get("foul_won_reward", 0.1)
    penalty_pos = stats.penalty_won * c.get("penalty_won_reward", 0.35)

    possession_loss_rate = stats.possession_lost_ctrl / max(stats.touches, 1)
    poss_loss = possession_loss_rate * c.get("possession_loss_rate_penalty", 0.08)

    error_pen = stats.error_lead_to_goal * c.get("error_lead_to_goal_penalty", 0.3)

    return fouls + penalty_pos - poss_loss - error_pen


def calc_shot_generation(stats: PlayerMatchStats, constants: dict) -> float:
    """
    Shot Generation — manufacturing shooting threat for yourself.

    Similar to ST but lighter weight for wingers.

    Raw = shots_total * shot_volume_reward
        + xg * xg_volume_weight
        + shot_accuracy_bonus (if shots_on_target >= 2 and rate >= threshold)
        + self_created_shots * self_created_shot_reward
        + assisted_shots * assisted_shot_reward
    """
    c = constants

    if stats.shots_total == 0:
        return 0.0

    shot_vol = stats.shots_total * c.get("shot_volume_reward", 0.05)
    xg_vol = stats.xg * c.get("xg_volume_weight", 0.3)

    shot_on_target_rate = stats.shots_on_target / stats.shots_total
    threshold = c.get("shot_on_target_threshold", 0.4)
    shot_acc = 0.0
    if stats.shots_on_target >= 2 and shot_on_target_rate >= threshold:
        shot_acc = c.get("shot_on_target_weight", 0.12)

    assisted_shots = stats.shots_total - stats.self_created_shots
    self_created = stats.self_created_shots * c.get("self_created_shot_reward", 0.2)
    assisted = assisted_shots * c.get("assisted_shot_reward", 0.05)

    return shot_vol + xg_vol + shot_acc + self_created + assisted


def calc_defensive(stats: PlayerMatchStats, constants: dict) -> float:
    """
    Defensive Contribution — tackles, interceptions, recoveries, duels.

    Wingers combine pressing + duel work into one lightweight dimension.

    Raw = tackles_won * tackle_reward
        + interceptions * interception_reward
        + ball_recovery * recovery_reward
        + aerial_won * aerial_win_reward
        - aerial_lost * aerial_loss_penalty
        + ground_won * ground_duel_win_reward
        - ground_lost * ground_duel_loss_penalty
    """
    c = constants
    return (
        stats.tackles_won * c.get("tackle_reward", 0.08)
        + stats.interceptions * c.get("interception_reward", 0.08)
        + stats.ball_recovery * c.get("recovery_reward", 0.06)
        + stats.aerial_duels_won * c.get("aerial_win_reward", 0.06)
        - stats.aerial_duels_lost * c.get("aerial_loss_penalty", 0.03)
        + stats.ground_duels_won * c.get("ground_duel_win_reward", 0.08)
        - stats.ground_duels_lost * c.get("ground_duel_loss_penalty", 0.04)
    )


def calc_presence(stats: PlayerMatchStats, constants: dict) -> float:
    """
    Presence — general involvement and passing contribution.

    Small reward for being on the ball, completing passes, and
    maintaining passing accuracy. Not a primary dimension — just
    ensures players who are involved get a small nod.

    Raw = touches * presence_factor
        + passes_completed * passes_completed_reward
        + (pass_accuracy - threshold) * pass_accuracy_weight
    """
    c = constants
    presence = stats.touches * c.get("presence_factor", 0.002)
    pass_vol = stats.passes_completed * c.get("passes_completed_reward", 0.04)

    pass_acc = stats.passes_completed / max(stats.passes_total, 1)
    pass_delta = (pass_acc - c.get("pass_accuracy_threshold", 0.65)) * c.get(
        "pass_accuracy_weight", 0.08
    )

    return presence + pass_vol + pass_delta


# Winger dimension names — order matters for iteration
W_CATEGORIES = [
    "productive_dribbling",
    "chance_creation",
    "goal_contribution",
    "carrying",
    "shot_generation",
    "defensive",
    "presence",
]

# Maps dimension name -> calc function
_CALC_MAP = {
    "productive_dribbling": calc_productive_dribbling,
    "chance_creation": calc_chance_creation,
    "goal_contribution": calc_goal_contribution,
    "carrying": calc_carrying,
    "shot_generation": calc_shot_generation,
    "defensive": calc_defensive,
    "presence": calc_presence,
}


def calculate_winger_rating(
    stats: PlayerMatchStats,
    config: dict,
) -> tuple[float, WingerCategoryScores]:
    """
    Calculate the full match rating for a winger.

    Returns (final_rating, category_scores).
    """
    constants = config["constants"]
    weights = config["weights"]
    baseline = config["baseline"]
    normalization = config.get("normalization", {})
    midpoints = normalization.get("midpoints", {})

    scores = WingerCategoryScores()

    # Compute raw scores for each dimension
    for cat in W_CATEGORIES:
        raw = _CALC_MAP[cat](stats, constants)
        setattr(scores, f"{cat}_raw", raw)

    # Normalize all dimensions
    for cat in W_CATEGORIES:
        raw = getattr(scores, f"{cat}_raw")
        mp = midpoints.get(cat, {})
        midpoint = mp.get("median", 0.0)
        scale = mp.get("scale", 1.0)
        norm = normalize_score(raw, midpoint, scale)
        setattr(scores, f"{cat}_norm", round(norm, 2))

    # Weighted sum
    weighted_sum = sum(
        weights[cat] * getattr(scores, f"{cat}_norm") for cat in W_CATEGORIES
    )

    # Direct bonuses — applied outside the dimension system
    np_goals = stats.goals - stats.penalty_goals
    goal_lift = np_goals * constants.get(
        "goal_bonus", 0.5
    ) + stats.penalty_goals * constants.get("penalty_goal_bonus", 0.35)
    assist_lift = stats.assists * constants.get("assist_bonus", 0.45)
    redcard_penalty = stats.red_cards * constants.get("red_card_penalty", -1.0)
    yellowcard_penalty = constants.get("yellow_card_penalty", -0.05)

    final = (
        baseline
        + weighted_sum
        + goal_lift
        + assist_lift
        + redcard_penalty
        + yellowcard_penalty
    )
    final = max(3.0, min(10.0, final))
    final = round(final, 1)

    return final, scores
