"""
CAM (Central Attacking Midfielder) Match Rating Calculator.

Calculates per-match player ratings for central attacking midfielders.
Each category produces a raw score, which is then normalized,
weighted, and combined with the baseline to produce a final rating.

Dimensions: chance_creation, goal_threat, team_function, carrying.
"""

from dataclasses import dataclass

from pipeline.engine.calculator import PlayerMatchStats, normalize_score


@dataclass
class CAMCategoryScores:
    """Raw and normalized scores per CAM category."""

    chance_creation_raw: float = 0.0
    goal_threat_raw: float = 0.0
    team_function_raw: float = 0.0
    carrying_raw: float = 0.0
    defensive_raw: float = 0.0
    chance_creation_norm: float = 0.0
    goal_threat_norm: float = 0.0
    team_function_norm: float = 0.0
    carrying_norm: float = 0.0
    defensive_norm: float = 0.0


def calc_chance_creation(stats: PlayerMatchStats, constants: dict) -> float:
    """
    Chance Creation — quality of chances created for teammates.

    xA is the primary signal. Big chances and key passes layer on top.
    Elite creative performances (xa >= xa_high_threshold) earn a bonus.

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


def calc_goal_threat(stats: PlayerMatchStats, constants: dict) -> float:
    """
    Goal Threat — finishing quality, shot volume, and self-creation.

    Merges finishing quality and shot generation into one dimension.
    A CAM who creates chances for themselves and converts them deserves
    full credit in a single signal, not split across two dimensions.

    When shots_total == 0: returns 0.0 (neutral — no threat registered).

    Raw = finishing_score (per-shot sum of goal - xG)
        + xg * xg_volume_weight
        + shots_total * shot_volume_reward
        + shot_acc_bonus (if shots_on_target >= 2 and rate >= threshold)
        + self_created_shots * self_created_shot_reward
        + assisted_shots * assisted_shot_reward
        + xg_overperformance_bonus (if np_goals > xg)
    """
    c = constants

    if stats.shots_total == 0:
        return 0.0

    finishing = stats.finishing_score
    xg_vol = stats.xg * c.get("xg_volume_weight", 0.3)
    shot_vol = stats.shots_total * c.get("shot_volume_reward", 0.05)

    shot_on_target_rate = stats.shots_on_target / stats.shots_total
    shot_acc = 0.0
    if stats.shots_on_target >= 2 and shot_on_target_rate >= c.get(
        "shot_on_target_threshold", 0.4
    ):
        shot_acc = c.get("shot_on_target_weight", 0.12)

    assisted_shots = stats.shots_total - stats.self_created_shots
    self_created = stats.self_created_shots * c.get("self_created_shot_reward", 0.2)
    assisted = assisted_shots * c.get("assisted_shot_reward", 0.05)

    xg_over = 0.0
    np_goals = stats.goals - stats.penalty_goals
    if np_goals > 0 and stats.xg > 0 and np_goals > stats.xg:
        xg_over = c.get("xg_overperformance_bonus", 0.3)

    return finishing + xg_vol + shot_vol + shot_acc + self_created + assisted + xg_over


def calc_team_function(stats: PlayerMatchStats, constants: dict) -> float:
    """
    Team Function — presence and passing volume.

    No accuracy gate: danger men need to be dangerous, not tidy.
    Rewards being on the ball and moving it forward, nothing more.

    Raw = touches * presence_factor
        + passes_completed * passes_completed_reward
    """
    c = constants
    presence = stats.touches * c.get("presence_factor", 0.002)
    pass_vol = stats.passes_completed * c.get("passes_completed_reward", 0.05)
    return presence + pass_vol


def calc_carrying(stats: PlayerMatchStats, constants: dict) -> float:
    """
    Carrying & Ball Retention.

    CAMs operate in crowded central space — dribble success baseline is 0.38
    (same as ST), reflecting tighter defensive pressure than wide areas.
    Possession loss is rate-based (loss / touches) not raw count.

    Raw = dribble_score
        + fouls_won * foul_won_reward
        + penalty_won * penalty_won_reward
        - possession_loss_rate * possession_loss_rate_penalty
        - error_lead_to_goal * error_lead_to_goal_penalty
    """
    c = constants

    dribble_volume = stats.successful_dribbles + stats.failed_dribbles
    dribble_rate = stats.successful_dribbles / max(dribble_volume, 1)
    dribble_score = (dribble_rate - 0.38) * c.get(
        "dribble_rate_weight", 0.2
    ) + stats.successful_dribbles * c.get("dribble_volume_reward", 0.1)

    fouls = stats.fouls_won * c.get("foul_won_reward", 0.1)
    penalty_pos = stats.penalty_won * c.get("penalty_won_reward", 0.35)

    possession_loss_rate = stats.possession_lost_ctrl / max(stats.touches, 1)
    poss_loss = possession_loss_rate * c.get("possession_loss_rate_penalty", 0.1)

    error_pen = stats.error_lead_to_goal * c.get("error_lead_to_goal_penalty", 0.3)

    return dribble_score + fouls + penalty_pos - poss_loss - error_pen


def calc_defensive(stats: PlayerMatchStats, constants: dict) -> float:
    """
    Defensive Contribution — pressing and recovery.

    CAMs contribute defensively through pressing (ball recovery),
    interceptions, tackles, and winning duels. Lightweight at 5% weight —
    rewards work rate without penalising pure creators who press minimally.

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


# CAM dimension names — order matters for iteration
CAM_CATEGORIES = ["chance_creation", "goal_threat", "team_function", "carrying", "defensive"]

# Maps dimension name -> calc function
_CALC_MAP = {
    "chance_creation": calc_chance_creation,
    "goal_threat": calc_goal_threat,
    "team_function": calc_team_function,
    "carrying": calc_carrying,
    "defensive": calc_defensive,
}


def calculate_cam_rating(
    stats: PlayerMatchStats,
    config: dict,
) -> tuple[float, CAMCategoryScores]:
    """
    Calculate the full match rating for a CAM.

    Returns (final_rating, category_scores).
    """
    constants = config["constants"]
    weights = config["weights"]
    baseline = config["baseline"]
    normalization = config.get("normalization", {})
    midpoints = normalization.get("midpoints", {})

    scores = CAMCategoryScores()

    # Compute raw scores for each dimension
    for cat in CAM_CATEGORIES:
        raw = _CALC_MAP[cat](stats, constants)
        setattr(scores, f"{cat}_raw", raw)

    # Normalize all dimensions
    for cat in CAM_CATEGORIES:
        raw = getattr(scores, f"{cat}_raw")
        mp = midpoints.get(cat, {})
        midpoint = mp.get("median", 0.0)
        scale = mp.get("scale", 1.0)
        norm = normalize_score(raw, midpoint, scale)
        setattr(scores, f"{cat}_norm", round(norm, 2))

    # Weighted sum
    weighted_sum = sum(
        weights[cat] * getattr(scores, f"{cat}_norm") for cat in CAM_CATEGORIES
    )

    # Direct bonuses — applied outside the dimension system
    np_goals = stats.goals - stats.penalty_goals
    goal_lift = np_goals * constants.get(
        "goal_bonus", 0.5
    ) + stats.penalty_goals * constants.get("penalty_goal_bonus", 0.35)
    assist_lift = stats.assists * constants.get("assist_bonus", 0.45)
    redcard_penalty = stats.red_cards * constants.get("red_card_penalty", -1.0)
    yellowcard_penalty = constants.get("yellow_card_penalty", -0.05)

    # Ghost penalty — fully invisible match: no xa, no key passes, no shots,
    # no goals, no assists, no big chances created
    ghost_pen = 0.0
    if (
        stats.minutes_played >= constants.get("ghost_min_minutes", 45)
        and stats.xa <= 0.09
        and stats.shots_total <= 2
        and stats.goals == 0
        and stats.assists == 0
        and stats.big_chance_created == 0
    ):
        ghost_pen = constants.get("ghost_penalty", -0.7)

    final = (
        baseline
        + weighted_sum
        + goal_lift
        + assist_lift
        + ghost_pen
        + redcard_penalty
        + yellowcard_penalty
    )
    final = max(3.0, min(10.0, final))
    final = round(final, 1)

    return final, scores
