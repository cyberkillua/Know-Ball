from pipeline.engine.season_score import (
    DEFAULT_SEASON_SCORE_CONFIG,
    calculate_season_score,
)


def _config() -> dict:
    cfg = DEFAULT_SEASON_SCORE_CONFIG.copy()
    cfg["weights"] = {
        "quality": 0.35,
        "consistency": 0.28,
        "peak": 0.12,
        "availability": 0.25,
    }
    return cfg


def test_low_minutes_are_shrunk_even_with_elite_match_ratings():
    score = calculate_season_score(
        avg_match_rating=9.1,
        peak_match_rating=9.6,
        consistency_score=90,
        rated_minutes=540,
        min_minutes=300,
        available_minutes=2700,
        config=_config(),
    )

    assert score.confidence == 33.33
    assert score.availability == 33.33
    assert score.final_score < 62


def test_trusted_minutes_keep_elite_match_ratings_near_raw_level():
    low_minutes = calculate_season_score(
        avg_match_rating=9.1,
        peak_match_rating=9.6,
        consistency_score=90,
        rated_minutes=540,
        min_minutes=300,
        available_minutes=2700,
        config=_config(),
    )
    trusted_minutes = calculate_season_score(
        avg_match_rating=9.1,
        peak_match_rating=9.6,
        consistency_score=90,
        rated_minutes=1800,
        min_minutes=300,
        available_minutes=2700,
        config=_config(),
    )

    assert trusted_minutes.confidence == 100
    assert trusted_minutes.final_score > low_minutes.final_score + 20
    assert trusted_minutes.final_score > 80

