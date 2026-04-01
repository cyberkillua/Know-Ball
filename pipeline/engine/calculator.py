"""
ST Match Rating Calculator.

Calculates per-match player ratings based on raw stats.
Each category produces a raw score, which is then normalized,
weighted, and combined with the baseline to produce a final rating.
"""

from dataclasses import dataclass


@dataclass
class PlayerMatchStats:
    """Raw stats for a single player in a single match."""
    minutes_played: int = 0
    goals: int = 0
    shots_total: int = 0
    shots_on_target: int = 0
    shots_off_target: int = 0
    xg: float = 0.0
    xgot: float = 0.0
    assists: int = 0
    xa: float = 0.0
    key_passes: int = 0
    touches: int = 0
    passes_total: int = 0
    passes_completed: int = 0
    successful_dribbles: int = 0
    failed_dribbles: int = 0
    fouls_won: int = 0
    aerial_duels_won: int = 0
    aerial_duels_lost: int = 0
    ground_duels_won: int = 0
    ground_duels_lost: int = 0
    tackles_won: int = 0
    interceptions: int = 0
    ball_recovery: int = 0
    # Shot-level data (from Understat, optional)
    self_created_goals: int = 0  # goals where last_action was Dribble or IndividualPlay
    # Expanded stats (from Sofascore)
    big_chance_missed: int = 0
    big_chance_created: int = 0
    blocked_scoring_attempt: int = 0
    penalty_won: int = 0
    possession_lost_ctrl: int = 0
    error_lead_to_goal: int = 0
    # Team context (from match_team_stats, for contextual no-shot penalty)
    team_possession_pct: float = 0.0
    team_total_shots: int = 0


@dataclass
class CategoryScores:
    """Raw and normalized scores per category."""
    finishing_raw: float = 0.0
    involvement_raw: float = 0.0
    carrying_raw: float = 0.0
    physical_raw: float = 0.0
    pressing_raw: float = 0.0
    finishing_norm: float = 0.0
    involvement_norm: float = 0.0
    carrying_norm: float = 0.0
    physical_norm: float = 0.0
    pressing_norm: float = 0.0


def calc_finishing(stats: PlayerMatchStats, constants: dict) -> float:
    """
    Finishing & Shot Quality.

    When shots_total == 0: contextual no-shot penalty based on team context.

    When shots_total > 0:
    Raw = (goals * goal_bonus)
        + (xgot - xg)                              # shot quality delta
        - (wastage_factor * max(0, xg - goals))    # wastage penalty
        + (self_created_goals * self_created_bonus)
        - (big_chance_missed * big_chance_missed_penalty)
        + max(0, shot_on_target_rate - threshold) * shot_on_target_weight
        + (xg_per_shot - league_avg_xg_per_shot) * position_quality_weight
        + blocked_scoring_attempt * blocked_attempt_reward
    """
    c = constants

    # Contextual no-shot penalty for strikers who never attempted a shot
    if stats.shots_total == 0:
        threshold_poss = c.get("low_possession_threshold", 35)
        threshold_shots = c.get("low_team_shots_threshold", 8)
        team_shut_down = (
            stats.team_possession_pct < threshold_poss
            or (stats.team_total_shots > 0 and stats.team_total_shots < threshold_shots)
        )
        if team_shut_down:
            return c.get("no_shot_penalty_light", 0.0)
        elif stats.touches < 20:
            return c.get("no_shot_penalty_heavy", 0.0)
        elif stats.assists > 0 or stats.key_passes > 0:
            return c.get("no_shot_penalty_light", 0.0)
        else:
            return c.get("no_shot_penalty_moderate", 0.0)

    goal_value = stats.goals * c["goal_bonus"]
    shot_quality = stats.xgot - stats.xg
    wastage = c["wastage_factor"] * max(0, stats.xg - stats.goals)
    self_created = stats.self_created_goals * c["self_created_bonus"]
    big_chance_penalty = stats.big_chance_missed * c.get("big_chance_missed_penalty", 0.0)

    # Shot accuracy bonus: reward above-average on-target rate
    shot_on_target_rate = stats.shots_on_target / stats.shots_total
    threshold = c.get("shot_on_target_threshold", 0.40)
    shot_acc_bonus = max(0.0, shot_on_target_rate - threshold) * c.get("shot_on_target_weight", 0.15)

    # Position quality bonus: reward taking high-xG shots
    xg_per_shot = stats.xg / stats.shots_total
    league_avg = c.get("league_avg_xg_per_shot", 0.12)
    position_quality = (xg_per_shot - league_avg) * c.get("position_quality_weight", 0.10)

    # Blocked attempt reward: real attacking output even without goal
    blocked_bonus = stats.blocked_scoring_attempt * c.get("blocked_attempt_reward", 0.04)

    return (goal_value + shot_quality - wastage + self_created
            - big_chance_penalty + shot_acc_bonus + position_quality + blocked_bonus)


def calc_involvement(stats: PlayerMatchStats, constants: dict) -> float:
    """
    Involvement & Link-up Play.

    xa double-count fix: split xa into converted (already counted via assists)
    and unconverted (the xA on chances that didn't become assists).

    Raw = (assists * assist_bonus)
        + max(0, xa - (assists * avg_xa_per_assist))   # unconverted xA only
        + (big_chance_created * big_chance_created_reward)
        + (key_passes * 0.08)
        + (passes_completed / max(passes_total, 1) - 0.7) * 0.5
        + (touches * presence_factor)
    """
    c = constants
    assist_value = stats.assists * c["assist_bonus"]

    # Only reward the portion of xA not already captured by assist_bonus
    avg_xa_per_assist = c.get("avg_xa_per_assist", 0.35)
    converted_xa = stats.assists * avg_xa_per_assist
    xa_value = max(0.0, stats.xa - converted_xa)

    bcc_value = stats.big_chance_created * c.get("big_chance_created_reward", 0.18)
    key_pass_value = stats.key_passes * 0.08
    pass_acc = stats.passes_completed / max(stats.passes_total, 1)
    pass_delta = (pass_acc - 0.7) * 0.5
    presence = stats.touches * c["presence_factor"]
    return assist_value + xa_value + bcc_value + key_pass_value + pass_delta + presence


def calc_carrying(stats: PlayerMatchStats, constants: dict) -> float:
    """
    Carrying & Ball Retention.

    Possession loss is rate-based (loss / touches) not raw count.
    Dribble score combines success rate and volume.

    Raw = dribble_score
        + (fouls_won * foul_won_reward)
        + (penalty_won * penalty_won_reward)
        - (possession_loss_rate * possession_loss_rate_penalty)
        - (error_lead_to_goal * error_lead_to_goal_penalty)
    """
    c = constants

    # Rate-based dribble score: rewards high success rate and volume
    dribble_volume = stats.successful_dribbles + stats.failed_dribbles
    dribble_rate = stats.successful_dribbles / max(dribble_volume, 1)
    dribble_score = (
        (dribble_rate - 0.50) * c.get("dribble_rate_weight", 0.30)
        + stats.successful_dribbles * c.get("dribble_volume_reward", 0.05)
    )

    fouls = stats.fouls_won * c["foul_won_reward"]
    penalty_pos = stats.penalty_won * c.get("penalty_won_reward", 0.0)

    # Rate-based possession loss penalty
    possession_loss_rate = stats.possession_lost_ctrl / max(stats.touches, 1)
    poss_loss = possession_loss_rate * c.get("possession_loss_rate_penalty", 0.8)

    error_pen = stats.error_lead_to_goal * c.get("error_lead_to_goal_penalty", 0.0)
    return dribble_score + fouls + penalty_pos - poss_loss - error_pen


def calc_physical(stats: PlayerMatchStats, constants: dict) -> float:
    """
    Physical & Duels.

    Raw = (aerial_won * aerial_win_reward)
        - (aerial_lost * aerial_loss_penalty)
        + (ground_won * ground_duel_win_reward)
        - (ground_lost * ground_duel_loss_penalty)
    """
    c = constants
    aerial = (stats.aerial_duels_won * c["aerial_win_reward"]
              - stats.aerial_duels_lost * c["aerial_loss_penalty"])
    ground = (stats.ground_duels_won * c["ground_duel_win_reward"]
              - stats.ground_duels_lost * c["ground_duel_loss_penalty"])
    return aerial + ground


def calc_pressing(stats: PlayerMatchStats, constants: dict) -> float:
    """
    Pressing & Defensive Contribution.

    ball_recovery is the primary pressing signal for strikers —
    more common than tackles/interceptions and captures high press.

    Raw = (tackles_won * tackle_reward)
        + (interceptions * interception_reward)
        + (ball_recovery * recovery_reward)
    """
    c = constants
    return (stats.tackles_won * c["tackle_reward"]
            + stats.interceptions * c["interception_reward"]
            + stats.ball_recovery * c.get("recovery_reward", 0.08))


def normalize_score(raw: float, midpoint: float, scale: float) -> float:
    """
    Normalize a raw category score.

    Centers at midpoint, divides by scale to get a value roughly in [-3, +3].
    During calibration, midpoint = median raw score, scale = IQR.
    Clamped to [-3, +3] so no single category can dominate.
    """
    if scale == 0:
        return 0.0
    norm = (raw - midpoint) / scale
    return max(-3.0, min(3.0, norm))


def calculate_match_rating(
    stats: PlayerMatchStats,
    config: dict,
) -> tuple[float, CategoryScores]:
    """
    Calculate the full match rating for a player.

    Returns (final_rating, category_scores).
    """
    constants = config["constants"]
    weights = config["weights"]
    baseline = config["baseline"]
    normalization = config.get("normalization", {})
    midpoints = normalization.get("midpoints", {})

    # Calculate raw scores
    scores = CategoryScores()
    scores.finishing_raw = calc_finishing(stats, constants)
    scores.involvement_raw = calc_involvement(stats, constants)
    scores.carrying_raw = calc_carrying(stats, constants)
    scores.physical_raw = calc_physical(stats, constants)
    scores.pressing_raw = calc_pressing(stats, constants)

    # Normalize (pre-calibration: use midpoint=0, scale=1 as pass-through)
    categories = ["finishing", "involvement", "carrying", "physical", "pressing"]
    for cat in categories:
        raw = getattr(scores, f"{cat}_raw")
        mp = midpoints.get(cat, {})
        midpoint = mp.get("median", 0.0)
        scale = mp.get("scale", 1.0)
        norm = normalize_score(raw, midpoint, scale)
        setattr(scores, f"{cat}_norm", round(norm, 2))

    # Weighted sum
    weighted_sum = sum(
        weights[cat] * getattr(scores, f"{cat}_norm")
        for cat in categories
    )

    # Final rating
    final = baseline + weighted_sum
    final = max(3.0, min(10.0, final))
    final = round(final, 1)

    return final, scores
