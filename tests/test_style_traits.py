from pipeline.engine.traits import assign_style_profile


def test_st_style_profile_returns_primary_strengths_and_confidence():
    profile = assign_style_profile(
        {
            "rated_minutes": 1600,
            "shots_per90_percentile": 88,
            "shot_generation_percentile": 86,
            "xg_per90_percentile": 83,
            "np_goals_per90_percentile": 72,
            "xg_per_shot_percentile": 61,
            "finishing_percentile": 64,
            "shot_conversion_percentile": 58,
            "chance_creation_percentile": 38,
            "xa_per90_percentile": 35,
            "key_passes_per90_percentile": 34,
            "team_function_percentile": 42,
            "assists_per90_percentile": 28,
            "carrying_percentile": 48,
            "dribbles_per90_percentile": 45,
            "dribble_success_percentile": 47,
            "fouls_won_per90_percentile": 46,
            "duels_percentile": 52,
            "aerials_per90_percentile": 41,
            "aerial_win_rate_percentile": 44,
            "ground_duels_won_per90_percentile": 50,
            "defensive_percentile": 31,
            "ball_recoveries_per90_percentile": 39,
            "tackles_per90_percentile": 32,
            "interceptions_per90_percentile": 30,
            "touches_per90_percentile": 50,
            "possession_loss_rate_percentile": 62,
        },
        "ST",
    )

    assert profile is not None
    assert profile["primary"]["key"] == "shot_getter"
    assert profile["strengths"][0]["label"] == "Shot Getter"
    assert profile["confidence"]["level"] in {"moderate", "high"}
    assert profile["evidence"][0]["label"] == "Shot volume"


def test_st_trait_gate_caps_volume_without_success():
    profile = assign_style_profile(
        {
            "rated_minutes": 1800,
            "carrying_percentile": 90,
            "dribbles_per90_percentile": 90,
            "dribble_success_percentile": 24,
            "fouls_won_per90_percentile": 85,
            "possession_loss_rate_percentile": 70,
        },
        "ST",
    )

    assert profile is not None
    ball_carrier = next(
        trait for trait in profile["top"] if trait["key"] == "ball_carrier"
    )
    assert ball_carrier["score"] == 55
    assert ball_carrier["concerns"][0]["metric"] == "dribble_success_percentile"


def test_unknown_position_without_traits_returns_none():
    assert assign_style_profile({"rated_minutes": 1200}, "GK") is None


def test_winger_style_profile_uses_winger_traits():
    profile = assign_style_profile(
        {
            "rated_minutes": 1400,
            "productive_dribbling_percentile": 88,
            "dribbles_per90_percentile": 84,
            "dribble_success_percentile": 79,
            "carrying_percentile": 82,
            "progressive_carries_distance_per90_percentile": 77,
            "fouls_won_per90_percentile": 70,
            "touches_per90_percentile": 66,
            "goal_contribution_percentile": 55,
            "shot_generation_percentile": 60,
            "shots_per90_percentile": 57,
            "xg_per90_percentile": 52,
            "np_goals_per90_percentile": 48,
            "chance_creation_percentile": 42,
            "xa_per90_percentile": 40,
            "key_passes_per90_percentile": 39,
            "accurate_cross_per90_percentile": 35,
            "big_chances_created_percentile": 36,
            "defensive_percentile": 45,
            "ball_recoveries_per90_percentile": 44,
            "tackles_per90_percentile": 43,
            "interceptions_per90_percentile": 42,
            "presence_percentile": 55,
            "possession_loss_rate_percentile": 58,
        },
        "WINGER",
    )

    assert profile is not None
    assert profile["primary"]["key"] == "wide_isolator"
    assert profile["coverage"] == 100


def test_defender_style_profile_uses_defender_traits():
    profile = assign_style_profile(
        {
            "rated_minutes": 1800,
            "defensive_percentile": 86,
            "interceptions_per90_percentile": 78,
            "tackles_per90_percentile": 74,
            "ball_recoveries_per90_percentile": 80,
            "duels_percentile": 82,
            "aerials_per90_percentile": 76,
            "aerial_win_rate_percentile": 73,
            "ground_duels_won_per90_percentile": 70,
            "volume_passing_percentile": 42,
            "pass_value_normalized_percentile": 38,
            "accurate_long_balls_per90_percentile": 41,
            "long_ball_accuracy_percentile": 44,
            "team_function_percentile": 52,
            "carrying_percentile": 55,
            "ground_duel_win_rate_percentile": 65,
            "goal_threat_percentile": 30,
            "xg_per90_percentile": 28,
            "shots_per90_percentile": 25,
            "xg_per_shot_percentile": 31,
            "passing_accuracy_percentile": 62,
            "possession_loss_rate_percentile": 67,
        },
        "DEF",
    )

    assert profile is not None
    assert profile["primary"]["key"] == "box_defender"
    assert profile["strengths"][0]["label"] == "Box Defender"
