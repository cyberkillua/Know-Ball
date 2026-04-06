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
    penalty_goals: int = 0  # for np_goals derivation
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
    self_created_shots: int = 0  # all shots where last_action was Dribble or IndividualPlay
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

    # v7 dimensions
    finishing_raw: float = 0.0
    shot_generation_raw: float = 0.0
    chance_creation_raw: float = 0.0
    team_function_raw: float = 0.0
    carrying_raw: float = 0.0
    duels_raw: float = 0.0
    defensive_raw: float = 0.0
    finishing_norm: float = 0.0
    shot_generation_norm: float = 0.0
    chance_creation_norm: float = 0.0
    team_function_norm: float = 0.0
    carrying_norm: float = 0.0
    duels_norm: float = 0.0
    defensive_norm: float = 0.0


def calc_finishing(stats: PlayerMatchStats, constants: dict) -> float:
    """
    Finishing & Shot Quality.

    Uses np_goals (goals - penalty_goals) as primary signal to strip
    set-piece inflation. xGOT quality delta is the most honest finishing stat.

    When shots_total == 0: contextual no-shot penalty based on team context.

    When shots_total > 0:
    Raw = (np_goals * goal_bonus)
        + (xgot - xg)                              # shot quality delta
        - (wastage_factor * max(0, xg - goals))    # wastage penalty
        + (self_created_goals * self_created_bonus)
        - (big_chance_missed * big_chance_missed_penalty)
    """
    c = constants

    # Contextual no-shot penalty for strikers who never attempted a shot
    if stats.shots_total == 0:
        if stats.assists + stats.big_chance_created < 2:
            return c.get("no_shot_penalty", -0.15)
        else:
            return 0.0  # waived if you created

    np_goals = stats.goals - stats.penalty_goals
    goal_value = np_goals * c["goal_bonus"]
    shot_quality = (stats.xgot - stats.xg) * c.get("xgot_delta_weight", 1.2)
    self_created = stats.self_created_goals * c["self_created_bonus"]
    big_chance_penalty = stats.big_chance_missed * c.get(
        "big_chance_missed_penalty", 0.0
    )

    return goal_value + shot_quality + self_created - big_chance_penalty


def calc_shot_generation(stats: PlayerMatchStats, constants: dict) -> float:
    """
    Shot Generation — manufacturing shooting threat.

    Rewards shot volume, on-target rate, shot position quality, and
    blocked attempts (proxy for shooting intent in crowded boxes).

    Raw = (shots_total * shot_volume_reward)
        + max(0, shot_on_target_rate - threshold) * shot_on_target_weight
        + (xg_per_shot - league_avg_xg_per_shot) * position_quality_weight
        + (blocked_scoring_attempt * blocked_attempt_reward)
    """
    c = constants

    if stats.shots_total == 0:
        return 0.0

    volume_bonus = stats.shots_total * c.get("shot_volume_reward", 0.07)

    shot_on_target_rate = stats.shots_on_target / stats.shots_total
    threshold = c.get("shot_on_target_threshold", 0.40)
    shot_acc_bonus = 0.0
    if stats.shots_total >= 2:
        shot_acc_bonus = max(0.0, shot_on_target_rate - threshold) * c.get(
            "shot_on_target_weight", 0.15
        )

    xg_per_shot = stats.xg / stats.shots_total
    league_avg = c.get("league_avg_xg_per_shot", 0.12)
    position_quality = (xg_per_shot - league_avg) * c.get(
        "position_quality_weight", 0.10
    )

    non_goal_self_created = max(0, stats.self_created_shots - stats.self_created_goals)
    self_created = non_goal_self_created * c.get("self_created_shot_reward", 0.15)

    return volume_bonus + shot_acc_bonus + position_quality + self_created


def calc_chance_creation(stats: PlayerMatchStats, constants: dict) -> float:
    """
    Chance Creation for Teammates.

    xa double-count fix: split xa into converted (already counted via assists)
    and unconverted (the xA on chances that didn't become assists).

    Raw = (assists * assist_bonus)
        + max(0, xa - (assists * avg_xa_per_assist))   # unconverted xA only
        + (big_chance_created * big_chance_created_reward)
        + (key_passes * key_pass_reward)
    """
    c = constants
    assist_value = stats.assists * c["assist_bonus"]

    # Only deduct actual xA attributed to assists, capped at stats.xa.
    converted_xa = min(stats.xa, stats.assists * c.get("avg_xa_per_assist", 0.35))
    unconverted_xa = max(0.0, stats.xa - converted_xa)

    # Only reward xA meaningfully above the noise floor (0.1 threshold)
    xa_threshold = c.get("xa_threshold", 0.1)
    xa_value = max(0.0, unconverted_xa - xa_threshold)

    return assist_value + xa_value


def calc_team_function(stats: PlayerMatchStats, constants: dict) -> float:
    """
    Team Function & Link-up Play.

    Being an outlet, target man, involved in build-up.

    Raw = (passes_completed / max(passes_total, 1) - 0.7) * pass_accuracy_weight
        + (touches * presence_factor)
    """
    c = constants
    pass_acc = stats.passes_completed / max(stats.passes_total, 1)
    pass_delta = (pass_acc - c.get("pass_accuracy_threshold", 0.7)) * c.get(
        "pass_accuracy_weight", 0.5
    )
    presence = stats.touches * c["presence_factor"]
    return pass_delta + presence


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

    dribble_volume = stats.successful_dribbles + stats.failed_dribbles
    dribble_rate = stats.successful_dribbles / max(dribble_volume, 1)
    dribble_score = (dribble_rate - 0.50) * c.get(
        "dribble_rate_weight", 0.30
    ) + stats.successful_dribbles * c.get("dribble_volume_reward", 0.05)

    fouls = stats.fouls_won * c["foul_won_reward"]
    penalty_pos = stats.penalty_won * c.get("penalty_won_reward", 0.35)

    possession_loss_rate = stats.possession_lost_ctrl / max(stats.touches, 1)
    poss_loss = possession_loss_rate * c.get("possession_loss_rate_penalty", 0.8)

    error_pen = stats.error_lead_to_goal * c.get("error_lead_to_goal_penalty", 0.3)
    return dribble_score + fouls + penalty_pos - poss_loss - error_pen


def calc_duels(stats: PlayerMatchStats, constants: dict) -> float:
    """
    Aerial and Ground Duel Dominance.

    A striker who wins aerials is a long ball outlet and beats the press.
    One who wins ground duels drives into space and retains under pressure.

    Raw = (aerial_won * aerial_win_reward)
        - (aerial_lost * aerial_loss_penalty)
        + (ground_won * ground_duel_win_reward)
        - (ground_lost * ground_duel_loss_penalty)
    """
    c = constants
    aerial = (
        stats.aerial_duels_won * c["aerial_win_reward"]
        - stats.aerial_duels_lost * c["aerial_loss_penalty"]
    )
    ground = (
        stats.ground_duels_won * c["ground_duel_win_reward"]
        - stats.ground_duels_lost * c["ground_duel_loss_penalty"]
    )
    total_contests = (
        stats.aerial_duels_won + stats.aerial_duels_lost
        + stats.ground_duels_won + stats.ground_duels_lost
    )
    volume = total_contests * c.get("duel_volume_reward", 0.02)
    return aerial + ground + volume


def calc_defensive(stats: PlayerMatchStats, constants: dict) -> float:
    """
    Defensive Contribution — Pressing & Recovery.

    ball_recovery is the primary pressing signal for strikers —
    more common than tackles/interceptions and captures high press.

    Raw = (tackles_won * tackle_reward)
        + (interceptions * interception_reward)
        + (ball_recovery * recovery_reward)
    """
    c = constants
    return (
        stats.tackles_won * c["tackle_reward"]
        + stats.interceptions * c["interception_reward"]
        + stats.ball_recovery * c.get("recovery_reward", 0.08)
    )


def normalize_score(raw: float, midpoint: float, scale: float) -> float:
    """
    Normalize a raw category score.

    Centers at midpoint, divides by scale to get a value roughly in [-3, +3].
    During calibration, midpoint = median raw score, scale = IQR.

    Soft compression allows elite outliers to exceed ±3 with diminishing returns
    (~4.5–5.0 for genuinely exceptional performances) rather than hard-capping them.
    """
    if scale == 0:
        return 0.0
    norm = (raw - midpoint) / scale
    return norm / (1 + abs(norm) * 0.15)


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

    scores = CategoryScores()

    # v7 dimension scores
    scores.finishing_raw      = calc_finishing(stats, constants)
    scores.shot_generation_raw = calc_shot_generation(stats, constants)
    scores.chance_creation_raw = calc_chance_creation(stats, constants)
    scores.team_function_raw   = calc_team_function(stats, constants)
    scores.carrying_raw        = calc_carrying(stats, constants)
    scores.duels_raw           = calc_duels(stats, constants)
    scores.defensive_raw       = calc_defensive(stats, constants)

    # Normalize all v7 dimensions
    v7_categories = [
        "finishing",
        "shot_generation",
        "chance_creation",
        "team_function",
        "carrying",
        "duels",
        "defensive",
    ]
    for cat in v7_categories:
        raw = getattr(scores, f"{cat}_raw")
        mp = midpoints.get(cat, {})
        midpoint = mp.get("median", 0.0)
        scale = mp.get("scale", 1.0)
        norm = normalize_score(raw, midpoint, scale)
        setattr(scores, f"{cat}_norm", round(norm, 2))

    # Weighted sum using v7 weights
    weighted_sum = sum(
        weights[cat] * getattr(scores, f"{cat}_norm") for cat in v7_categories
    )

    final = baseline + weighted_sum
    final = max(3.0, min(10.0, final))
    final = round(final, 1)

    return final, scores
