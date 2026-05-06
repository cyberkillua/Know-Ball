"""Season-level Know Ball score helpers."""

from dataclasses import dataclass
import math


DEFAULT_SEASON_SCORE_CONFIG = {
    "version": 3,
    "weights": {
        "quality": 0.68,
        "consistency": 0.14,
        "peak": 0.10,
        "availability": 0.08,
    },
    "match_rating_min": 3.0,
    "match_rating_max": 10.0,
    "consistency_threshold": 6.8,
    "impact_threshold": 7.5,
    "availability_target_minutes": 1800,
    "availability_target_ratio": 0.60,
    "availability_floor": 0.0,
    "availability_curve": "linear",
    "availability_ratio_curve": "linear",
    "replacement_level_score": 50.0,
    "sample_size_shrinkage": True,
}


@dataclass
class SeasonScoreBreakdown:
    final_score: float
    quality: float
    consistency: float
    peak: float
    availability: float
    confidence: float
    version: int


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _scale_to_100(value: float, low: float, high: float) -> float:
    if high <= low:
        return 0.0
    return round(_clamp((value - low) / (high - low), 0.0, 1.0) * 100.0, 2)


def _apply_curve(progress: float, curve: str) -> float:
    bounded = _clamp(progress, 0.0, 1.0)
    return math.sqrt(bounded) if curve == "sqrt" else bounded


def _availability_score(
    rated_minutes: int,
    min_minutes: int,
    target_minutes: int,
    floor: float,
    curve: str,
) -> float:
    if rated_minutes <= 0:
        return 0.0

    if target_minutes <= min_minutes:
        target_minutes = min_minutes + 1

    if rated_minutes <= min_minutes:
        return round(floor * (rated_minutes / max(min_minutes, 1)), 2)

    progress = _clamp(
        (rated_minutes - min_minutes) / (target_minutes - min_minutes),
        0.0,
        1.0,
    )
    curved = _apply_curve(progress, curve)
    return round(floor + (100.0 - floor) * curved, 2)


def _availability_share_score(
    rated_minutes: int,
    available_minutes: int,
    target_ratio: float,
    curve: str,
) -> float:
    if rated_minutes <= 0 or available_minutes <= 0:
        return 0.0

    target_minutes = max(1.0, float(available_minutes) * target_ratio)
    return round(_apply_curve(rated_minutes / target_minutes, curve) * 100.0, 2)


def build_season_score_config(position_config: dict | None) -> dict:
    cfg = DEFAULT_SEASON_SCORE_CONFIG.copy()
    cfg["weights"] = DEFAULT_SEASON_SCORE_CONFIG["weights"].copy()
    if position_config:
        season_cfg = position_config.get("season_score", {})
        cfg.update({k: v for k, v in season_cfg.items() if k != "weights"})
        if "weights" in season_cfg:
            cfg["weights"].update(season_cfg["weights"])
    return cfg


def calculate_season_score(
    *,
    avg_match_rating: float | None,
    peak_match_rating: float | None,
    consistency_score: float | None,
    rated_minutes: int | None,
    min_minutes: int,
    config: dict,
    available_minutes: int | None = None,
) -> SeasonScoreBreakdown:
    avg_rating = float(avg_match_rating or 0.0)
    peak_rating = float(peak_match_rating or avg_rating)
    consistency = round(_clamp(float(consistency_score or 0.0), 0.0, 100.0), 2)
    minutes = int(rated_minutes or 0)

    rating_min = float(config.get("match_rating_min", 3.0))
    rating_max = float(config.get("match_rating_max", 10.0))
    availability_target = int(config.get("availability_target_minutes", 1800))
    availability_floor = float(
        config.get(
            "availability_floor",
            DEFAULT_SEASON_SCORE_CONFIG["availability_floor"],
        )
    )
    availability_curve = str(
        config.get(
            "availability_curve",
            DEFAULT_SEASON_SCORE_CONFIG["availability_curve"],
        )
    )
    availability_target_ratio = _clamp(
        float(config.get("availability_target_ratio", 0.60)),
        0.01,
        1.0,
    )
    availability_ratio_curve = str(config.get("availability_ratio_curve", "linear"))
    replacement_level_score = float(config.get("replacement_level_score", 50.0))
    sample_size_shrinkage = bool(config.get("sample_size_shrinkage", True))
    weights = config.get("weights", DEFAULT_SEASON_SCORE_CONFIG["weights"])

    quality = _scale_to_100(avg_rating, rating_min, rating_max)
    peak = _scale_to_100(peak_rating, rating_min, rating_max)
    if available_minutes and available_minutes > 0:
        availability = _availability_share_score(
            rated_minutes=minutes,
            available_minutes=int(available_minutes),
            target_ratio=availability_target_ratio,
            curve=availability_ratio_curve,
        )
    else:
        availability = _availability_score(
            rated_minutes=minutes,
            min_minutes=min_minutes,
            target_minutes=availability_target,
            floor=availability_floor,
            curve=availability_curve,
        )
    confidence = availability

    raw_score = (
        quality * float(weights.get("quality", 0.0))
        + consistency * float(weights.get("consistency", 0.0))
        + peak * float(weights.get("peak", 0.0))
        + availability * float(weights.get("availability", 0.0))
    )
    if minutes <= 0:
        final_score = 0.0
    elif sample_size_shrinkage:
        confidence_factor = _clamp(confidence / 100.0, 0.0, 1.0)
        final_score = round(
            replacement_level_score
            + (raw_score - replacement_level_score) * confidence_factor,
            2,
        )
    else:
        final_score = round(raw_score, 2)

    return SeasonScoreBreakdown(
        final_score=final_score,
        quality=quality,
        consistency=consistency,
        peak=peak,
        availability=availability,
        confidence=confidence,
        version=int(config.get("version", 3)),
    )
