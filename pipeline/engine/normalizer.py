"""
Calibration and normalization utilities.

Used to derive midpoints and scale factors from historical data,
which are then stored in the position config JSON.
"""

import numpy as np
from dataclasses import dataclass


@dataclass
class CategoryStats:
    """Distribution stats for a single rating category."""
    median: float
    q25: float
    q75: float
    scale: float  # IQR, used for normalization
    min_val: float
    max_val: float
    count: int


def compute_category_stats(raw_scores: list[float]) -> CategoryStats:
    """Compute distribution statistics for a list of raw category scores."""
    arr = np.array(raw_scores)
    q25, median, q75 = np.percentile(arr, [25, 50, 75])
    iqr = q75 - q25
    # Prevent zero/tiny scale — floor prevents zero-inflated dimensions
    # (e.g. chance_creation, finishing) from producing extreme normalized values.
    MIN_SCALE = 0.10
    if iqr < 0.001:
        scale = max(MIN_SCALE, float(np.std(arr)) if np.std(arr) > 0.001 else MIN_SCALE)
    else:
        scale = max(MIN_SCALE, float(iqr))

    return CategoryStats(
        median=float(median),
        q25=float(q25),
        q75=float(q75),
        scale=scale,
        min_val=float(arr.min()),
        max_val=float(arr.max()),
        count=len(arr),
    )


def calibrate_from_raw_scores(
    raw_scores_by_category: dict[str, list[float]],
) -> dict[str, dict]:
    """
    Given raw scores for each category across many matches,
    compute midpoints and scale factors for normalization.

    Returns a dict suitable for storing in config["normalization"]["midpoints"].
    """
    midpoints = {}
    for category, scores in raw_scores_by_category.items():
        if not scores:
            continue
        stats = compute_category_stats(scores)
        midpoints[category] = {
            "median": round(stats.median, 4),
            "scale": round(stats.scale, 4),
            "q25": round(stats.q25, 4),
            "q75": round(stats.q75, 4),
            "min": round(stats.min_val, 4),
            "max": round(stats.max_val, 4),
            "n": stats.count,
        }
    return midpoints
