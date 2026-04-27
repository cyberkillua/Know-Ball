"""
CM (Central Midfielder) Match Rating Calculator.

Scoring mechanism differs from ST/CAM/W: instead of a flat weighted sum,
CM uses "elite buckets". A bucket counts at full weight only when the player
performs in the top 25% of the CM population for that bucket. Mid-tier buckets
(25-75th percentile) count at a reduced factor. Poor buckets (bottom 25%) apply
a penalty scaled by that bucket's weight. A minimum number of buckets always
contribute at full weight.

The rationale: there is no single "correct" way to play CM. Rodri and Bellingham
are both elite but dominate different buckets. Averaging all dimensions equally
would produce a mediocre rating for each.

Dimensions: volume_passing, carrying, chance_creation, defensive, goal_threat.

Progressive-pass event tags are not available at match level in the current
dataset. volume_passing therefore uses pass_value_normalized as the anchor,
then adds conservative rewards for completed opposition-half passes and accurate
long balls as forward-pass proxies.
"""

from dataclasses import dataclass

from pipeline.engine.calculator import PlayerMatchStats, normalize_score


@dataclass
class CMCategoryScores:
    """Raw and normalized scores per CM bucket."""

    volume_passing_raw: float = 0.0
    carrying_raw: float = 0.0
    chance_creation_raw: float = 0.0
    defensive_raw: float = 0.0
    goal_threat_raw: float = 0.0
    volume_passing_norm: float = 0.0
    carrying_norm: float = 0.0
    chance_creation_norm: float = 0.0
    defensive_norm: float = 0.0
    goal_threat_norm: float = 0.0


def calc_volume_passing(stats: PlayerMatchStats, constants: dict) -> float:
    """
    Progressive Passing — valuable passes that help the team move forward.

    Anchored on Sofascore's pass_value_normalized, their per-match
    passing impact metric (partially volume-independent at r=0.36 with
    passes_completed).

    Raw = pass_value_normalized * pass_value_weight
        + capped accurate_opposition_half_passes * opposition_half_pass_reward
        + opposition-half accuracy gate
        + capped accurate_long_balls * long_ball_reward
    """
    c = constants
    opposition_half_accuracy = stats.accurate_opposition_half_passes / max(
        stats.total_opposition_half_passes, 1
    )
    opposition_half_accuracy_delta = 0.0
    if stats.total_opposition_half_passes >= c.get(
        "opposition_half_accuracy_min_attempts", 5
    ):
        opposition_half_accuracy_delta = (
            opposition_half_accuracy
            - c.get("opposition_half_accuracy_threshold", 0.72)
        ) * c.get("opposition_half_accuracy_weight", 0.12)

    forward_volume = min(
        stats.accurate_opposition_half_passes,
        c.get("opposition_half_pass_cap", 45),
    ) * c.get("opposition_half_pass_reward", 0.008)
    long_ball_progression = min(
        stats.accurate_long_balls,
        c.get("accurate_long_ball_cap", 8),
    ) * c.get("accurate_long_ball_reward", 0.025)

    return (
        stats.pass_value_normalized * c.get("pass_value_weight", 0.6)
        + forward_volume
        + opposition_half_accuracy_delta
        + long_ball_progression
    )

def calc_carrying(stats: PlayerMatchStats, constants: dict) -> float:
    """
    Carrying — advancing the ball yourself.

    Rewards dribble rate + volume and progressive carry distance as direct
    measures of beating a defender and moving the ball up the pitch. Foul/penalty
    wins layer on top. Possession loss rate acts as a soft penalty.

    Dribble rate delta is clipped at zero so low-dribble carriers (Kroos-type)
    aren't penalised before progressive carry compensates. Fouls won are capped
    to prevent cynical-foul inflation dominating the bucket.

    Raw = dribble_score
        + progressive_carry_distance * progressive_carry_distance_weight
        + min(fouls_won, foul_won_cap) * foul_won_reward
        + penalty_won * penalty_won_reward
        - possession_loss_rate * possession_loss_rate_penalty
    """
    c = constants

    dribble_volume = stats.successful_dribbles + stats.failed_dribbles
    dribble_rate = stats.successful_dribbles / max(dribble_volume, 1)
    dribble_score = max(0, dribble_rate - 0.38) * c.get(
        "dribble_rate_weight", 0.15
    ) + stats.successful_dribbles * c.get("dribble_volume_reward", 0.05)

    progressive_carry = stats.total_progressive_ball_carries_distance * c.get(
        "progressive_carry_distance_weight", 0.002
    )

    fouls = min(stats.fouls_won, c.get("foul_won_cap", 5)) * c.get(
        "foul_won_reward", 0.06
    )
    penalty_pos = stats.penalty_won * c.get("penalty_won_reward", 0.3)

    possession_loss_rate = stats.possession_lost_ctrl / max(stats.touches, 1)
    poss_loss = possession_loss_rate * c.get("possession_loss_rate_penalty", 0.1)

    return dribble_score + progressive_carry + fouls + penalty_pos - poss_loss


def calc_chance_creation(stats: PlayerMatchStats, constants: dict) -> float:
    """
    Chance Creation — setting up shots for teammates.

    xA primary, big chances and key passes layer on top. No high-xA bonus here —
    elite creative lift is applied post-normalization (see high_xa_bonus).

    Raw = xa
        + big_chance_created * big_chance_created_reward
        + key_passes * key_pass_reward
    """
    c = constants
    return (
        stats.xa
        + stats.big_chance_created * c.get("big_chance_created_reward", 0.12)
        + stats.key_passes * c.get("key_pass_reward", 0.05)
    )


def calc_defensive(stats: PlayerMatchStats, constants: dict) -> float:
    """
    Defensive — pressing, recovery, and duels.

    Duels are absorbed here as a proxy for the missing engine/pressing bucket.

    Raw = tackles_won * tackle_reward
        + interceptions * interception_reward
        + ball_recovery * recovery_reward
        + aerial_won * aerial_win_reward - aerial_lost * aerial_loss_penalty
        + ground_won * ground_duel_win_reward - ground_lost * ground_duel_loss_penalty
        + total_duels * duel_volume_reward
    """
    c = constants
    total_duels = (
        stats.aerial_duels_won
        + stats.aerial_duels_lost
        + stats.ground_duels_won
        + stats.ground_duels_lost
    )
    return (
        stats.tackles_won * c.get("tackle_reward", 0.1)
        + stats.interceptions * c.get("interception_reward", 0.1)
        + stats.ball_recovery * c.get("recovery_reward", 0.08)
        + stats.aerial_duels_won * c.get("aerial_win_reward", 0.08)
        - stats.aerial_duels_lost * c.get("aerial_loss_penalty", 0.04)
        + stats.ground_duels_won * c.get("ground_duel_win_reward", 0.08)
        - stats.ground_duels_lost * c.get("ground_duel_loss_penalty", 0.04)
        + total_duels * c.get("duel_volume_reward", 0.002)
    )


def calc_goal_threat(stats: PlayerMatchStats, constants: dict) -> float:
    """
    Goal Threat — shots and xG generated.

    Lightest bucket by weight. xG overperformance bonus applies post-normalization,
    so an unexpected goal still rewards the player even if the bucket is only
    mid-tier on the day.

    Raw = finishing_score
        + xg * xg_volume_weight
        + shots_total * shot_volume_reward
        + shot_acc_bonus (if shots_on_target >= 2 and rate >= threshold)
        + self_created_shots * self_created_shot_reward
        + assisted_shots * assisted_shot_reward
    """
    c = constants
    if stats.shots_total == 0:
        return 0.0

    finishing = stats.finishing_score
    xg_vol = stats.xg * c.get("xg_volume_weight", 0.25)
    shot_vol = stats.shots_total * c.get("shot_volume_reward", 0.04)

    shot_on_target_rate = stats.shots_on_target / stats.shots_total
    shot_acc = 0.0
    if stats.shots_on_target >= 2 and shot_on_target_rate >= c.get(
        "shot_on_target_threshold", 0.4
    ):
        shot_acc = c.get("shot_on_target_weight", 0.1)

    assisted_shots = stats.shots_total - stats.self_created_shots
    self_created = stats.self_created_shots * c.get("self_created_shot_reward", 0.15)
    assisted = assisted_shots * c.get("assisted_shot_reward", 0.04)

    return finishing + xg_vol + shot_vol + shot_acc + self_created + assisted


CM_CATEGORIES = [
    "volume_passing",
    "carrying",
    "chance_creation",
    "defensive",
    "goal_threat",
]

_CALC_MAP = {
    "volume_passing": calc_volume_passing,
    "carrying": calc_carrying,
    "chance_creation": calc_chance_creation,
    "defensive": calc_defensive,
    "goal_threat": calc_goal_threat,
}


def _score_elite_buckets(
    raw_scores: dict[str, float],
    normalized: dict[str, float],
    weights: dict[str, float],
    midpoints: dict[str, dict],
    scoring_cfg: dict,
) -> tuple[float, dict[str, str]]:
    """
    Elite-bucket scoring.

    Classify each bucket as elite / mid / poor against p25/p75 raw thresholds
    from the CM population. Elite buckets contribute at full weight. Mid buckets
    contribute at non_elite_weight_factor (default 0.4). Poor buckets apply
    poor_bucket_penalty scaled by that bucket's weight in place of any weighted
    contribution.

    If fewer than min_buckets are elite, promote the highest-normalized mid
    buckets up to the floor. Poor buckets are never promoted — a player having
    a very bad match should reflect that in the final rating.

    Returns (weighted_sum + poor_adjustment, tiers).
    """
    mid_factor = scoring_cfg.get("non_elite_weight_factor", 0.4)
    poor_penalty = scoring_cfg.get("poor_bucket_penalty", -0.15)
    min_buckets = scoring_cfg.get("min_buckets", 3)

    tiers: dict[str, str] = {}
    for cat in CM_CATEGORIES:
        mp = midpoints.get(cat, {})
        median = mp.get("median", 0.0)
        scale = mp.get("scale", 1.0)
        # Support both legacy q25/q75 and the newer p25/p75 names.
        p25 = mp.get("p25", mp.get("q25", median - 0.5 * scale))
        p75 = mp.get("p75", mp.get("q75", median + 0.5 * scale))
        raw = raw_scores[cat]
        if raw >= p75:
            tiers[cat] = "elite"
        elif raw <= p25:
            tiers[cat] = "poor"
        else:
            tiers[cat] = "mid"

    elite_count = sum(1 for t in tiers.values() if t == "elite")
    if elite_count < min_buckets:
        needed = min_buckets - elite_count
        promotable = sorted(
            (c for c in CM_CATEGORIES if tiers[c] == "mid"),
            key=lambda c: normalized[c],
            reverse=True,
        )
        for c in promotable[:needed]:
            tiers[c] = "elite"

    weighted_sum = 0.0
    poor_adjustment = 0.0
    for cat in CM_CATEGORIES:
        tier = tiers[cat]
        w = weights[cat]
        n = normalized[cat]
        if tier == "elite":
            weighted_sum += w * n
        elif tier == "mid":
            weighted_sum += w * n * mid_factor
        else:  # poor
            poor_adjustment += poor_penalty * w

    return weighted_sum + poor_adjustment, tiers


def _weights_for_role(weights: dict[str, float], profile_position: str | None) -> dict[str, float]:
    role_weights = weights.copy()
    pos = (profile_position or "").upper().strip()
    if pos in {"CDM", "DM"}:
        goal_threat_drop = role_weights.get("goal_threat", 0.0) * 0.5
        role_weights["goal_threat"] = role_weights.get("goal_threat", 0.0) - goal_threat_drop
        role_weights["volume_passing"] = role_weights.get("volume_passing", 0.0) + goal_threat_drop * 0.45
        role_weights["defensive"] = role_weights.get("defensive", 0.0) + goal_threat_drop * 0.45
        role_weights["carrying"] = role_weights.get("carrying", 0.0) + goal_threat_drop * 0.10
    return role_weights


def calculate_cm_rating(
    stats: PlayerMatchStats,
    config: dict,
) -> tuple[float, CMCategoryScores]:
    """
    Calculate the full match rating for a CM.

    Returns (final_rating, category_scores).
    """
    constants = config["constants"]
    weights = _weights_for_role(config["weights"], stats.profile_position)
    baseline = config["baseline"]
    scoring_cfg = config.get("scoring", {})
    normalization = config.get("normalization", {})
    midpoints = normalization.get("midpoints", {})

    scores = CMCategoryScores()

    raw_scores: dict[str, float] = {}
    normalized: dict[str, float] = {}
    for cat in CM_CATEGORIES:
        raw = _CALC_MAP[cat](stats, constants)
        raw_scores[cat] = raw
        setattr(scores, f"{cat}_raw", raw)

        mp = midpoints.get(cat, {})
        median = mp.get("median", 0.0)
        scale = mp.get("scale", 1.0)
        norm = normalize_score(raw, median, scale)
        normalized[cat] = norm
        setattr(scores, f"{cat}_norm", round(norm, 2))

    bucket_score, _tiers = _score_elite_buckets(
        raw_scores, normalized, weights, midpoints, scoring_cfg
    )

    # Post-normalization adjustments — match-defining events that shouldn't be
    # diluted by the bucket machinery.
    np_goals = stats.goals - stats.penalty_goals
    goal_lift = np_goals * constants.get(
        "goal_bonus", 0.55
    ) + stats.penalty_goals * constants.get("penalty_goal_bonus", 0.35)
    assist_lift = stats.assists * constants.get("assist_bonus", 0.4)

    high_xa_bonus = 0.0
    if stats.xa >= constants.get("xa_high_threshold", 0.3):
        high_xa_bonus = constants.get("high_xa_bonus", 0.15)

    big_chance_missed_pen = stats.big_chance_missed * constants.get(
        "big_chance_missed_penalty", -0.1
    )
    error_pen = (
        stats.error_lead_to_goal * constants.get("error_lead_to_goal_penalty", 0.3) * -1
    )  # stored as positive magnitude, subtract
    redcard_penalty = stats.red_cards * constants.get("red_card_penalty", -1.0)
    yellowcard_penalty = stats.yellow_cards * constants.get(
        "yellow_card_penalty", -0.05
    )

    # Ghost penalty — CM played but barely touched anything meaningful
    ghost_pen = 0.0
    if (
        stats.minutes_played >= constants.get("ghost_min_minutes", 45)
        and stats.xa <= 0.09
        and stats.key_passes == 0
        and stats.shots_total <= 1
        and stats.goals == 0
        and stats.assists == 0
        and stats.big_chance_created == 0
        and stats.tackles_won + stats.interceptions + stats.ball_recovery <= 3
    ):
        ghost_pen = constants.get("ghost_penalty", -0.5)

    final = (
        baseline
        + bucket_score
        + goal_lift
        + assist_lift
        + high_xa_bonus
        + big_chance_missed_pen
        + error_pen
        + ghost_pen
        + redcard_penalty
        + yellowcard_penalty
    )
    final = max(3.0, min(10.0, final))
    final = round(final, 1)

    return final, scores
