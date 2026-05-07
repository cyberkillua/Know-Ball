from pipeline.engine.roles import assign_role_fit


def test_st_role_fit_returns_top_roles_and_confidence():
    fit = assign_role_fit(
        {
            "rated_minutes": 1800,
            "shot_generation_percentile": 86,
            "shots_per90_percentile": 84,
            "xg_per90_percentile": 82,
            "carrying_percentile": 68,
            "np_goals_per90_percentile": 75,
            "finishing_percentile": 62,
            "chance_creation_percentile": 38,
            "duels_percentile": 42,
        },
        "ST",
    )

    assert fit is not None
    assert fit["primary"]["key"] == "advanced_forward"
    assert len(fit["top"]) == 3
    assert fit["confidence"]["level"] in {"moderate", "high"}
    assert fit["evidence"][0]["label"] == "Shot generation"


def test_close_scores_are_marked_as_hybrid():
    fit = assign_role_fit(
        {
            "rated_minutes": 900,
            "finishing_percentile": 74,
            "np_goals_per90_percentile": 74,
            "shot_conversion_percentile": 74,
            "xg_per_shot_percentile": 74,
            "shot_generation_percentile": 74,
            "shots_per90_percentile": 74,
            "xg_per90_percentile": 74,
            "carrying_percentile": 74,
        },
        "ST",
    )

    assert fit is not None
    assert fit["confidence"]["hybrid"] is True


def test_no_present_signals_returns_none():
    assert assign_role_fit({"rated_minutes": 1200}, "CM") is None
