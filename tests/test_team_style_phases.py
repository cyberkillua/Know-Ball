from pipeline.model.compute_teams import _build_phase_profiles, _build_tendencies


def _sample_metrics():
    return {
        "xg_for": 1.2,
        "shots_for": 12.0,
        "big_chances_for": 1.4,
        "goals_for": 1.1,
        "finishing_overperformance": -0.1,
        "key_passes_for": 8.0,
        "possession": 45.0,
        "passes_for": 320.0,
        "pass_accuracy": 80.0,
        "goals_against": 1.5,
        "xg_against": 1.4,
        "shots_against": 15.0,
        "big_chances_against": 1.8,
    }


def test_phase_profiles_separate_attack_midfield_and_defence():
    metrics = _sample_metrics()
    percentiles = {
        "xg_for": 55,
        "shots_for": 70,
        "big_chances_for": 40,
        "goals_for": 60,
        "finishing_overperformance": 30,
        "key_passes_for": 65,
        "possession": 20,
        "passes_for": 25,
        "pass_accuracy": 50,
        "goals_against": 75,
        "xg_against": 80,
        "shots_against": 35,
        "big_chances_against": 30,
    }

    phases = _build_phase_profiles(metrics, percentiles)

    assert set(phases) == {"attack", "midfield", "defence"}
    assert [item["key"] for item in phases["attack"]["relative_strengths"]] == [
        "shots_for",
        "goals_for",
    ]
    assert [item["key"] for item in phases["midfield"]["improvements"]] == [
        "possession",
        "passes_for",
    ]
    assert [item["key"] for item in phases["defence"]["relative_strengths"]] == [
        "xg_against",
        "goals_against",
    ]
    assert [item["key"] for item in phases["defence"]["improvements"]] == [
        "big_chances_against",
        "shots_against",
    ]


def test_phase_improvements_include_room_to_improve_below_90th_percentile():
    metrics = _sample_metrics()
    percentiles = {key: 90 for key in metrics}
    percentiles["xg_for"] = 70

    phases = _build_phase_profiles(metrics, percentiles)

    assert [item["key"] for item in phases["attack"]["improvements"]] == ["xg_for"]
    assert phases["midfield"]["improvements"] == []
    assert phases["defence"]["improvements"] == []


def test_relative_strengths_exclude_below_average_metrics():
    metrics = _sample_metrics()
    percentiles = {key: 49 for key in metrics}
    percentiles["goals_against"] = 50

    phases = _build_phase_profiles(metrics, percentiles)

    assert phases["attack"]["relative_strengths"] == []
    assert phases["midfield"]["relative_strengths"] == []
    assert [item["key"] for item in phases["defence"]["relative_strengths"]] == [
        "goals_against"
    ]


def test_tendencies_identify_possession_led_and_shot_heavy_profiles():
    metrics = _sample_metrics()
    percentiles = {key: 50 for key in metrics}
    percentiles.update(
        {
            "possession": 85,
            "passes_for": 80,
            "pass_accuracy": 75,
            "shots_for": 80,
        }
    )

    tendencies = _build_tendencies(
        metrics,
        percentiles,
        {"attack": 70, "midfield": 80, "defence": 50},
    )

    keys = {item["key"] for item in tendencies}
    assert "possession_led" in keys
    assert "shot_heavy" in keys


def test_deep_block_tendency_is_cautious_and_evidence_backed():
    metrics = _sample_metrics()
    percentiles = {key: 50 for key in metrics}
    percentiles.update(
        {
            "possession": 20,
            "shots_against": 20,
            "goals_against": 75,
        }
    )

    tendencies = _build_tendencies(
        metrics,
        percentiles,
        {"attack": 40, "midfield": 30, "defence": 45},
    )

    deep_block = next(item for item in tendencies if item["key"] == "deep_block_profile")
    assert deep_block["confidence"] == "moderate"
    assert [item["key"] for item in deep_block["evidence"]] == [
        "possession",
        "shots_against",
        "goals_against",
    ]


def test_defensive_control_requires_actual_chance_suppression():
    metrics = _sample_metrics()
    percentiles = {key: 50 for key in metrics}
    percentiles.update(
        {
            "goals_against": 100,
            "xg_against": 45,
            "shots_against": 45,
            "big_chances_against": 100,
        }
    )

    tendencies = _build_tendencies(
        metrics,
        percentiles,
        {"attack": 50, "midfield": 50, "defence": 73},
    )

    assert "defensive_control" not in {item["key"] for item in tendencies}
