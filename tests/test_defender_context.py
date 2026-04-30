from copy import deepcopy

from pipeline.engine.calculator import PlayerMatchStats
from pipeline.engine.def_calculator import calculate_def_rating
from pipeline.engine.config import load_position_config


def _neutral_cb() -> PlayerMatchStats:
    return PlayerMatchStats(
        minutes_played=90,
        profile_position="CB",
        clearances=6,
        outfielder_block=1,
        interceptions=2,
        ball_recovery=5,
        tackles_won=1,
        aerial_duels_won=4,
        aerial_duels_lost=1,
        ground_duels_won=2,
        ground_duels_lost=1,
        touches=62,
        passes_total=50,
        passes_completed=43,
        accurate_long_balls=3,
        total_long_balls=6,
        pass_value_normalized=0.15,
        total_progressive_ball_carries_distance=30,
    )


def test_cb_context_rewards_strong_team_defending_and_win():
    config = load_position_config("DEF")
    base = _neutral_cb()
    base.team_goals_for = 1
    base.team_goals_conceded = 1
    base.team_expected_goals_conceded = 1.0
    base.team_big_chances_conceded = 1

    strong = deepcopy(base)
    strong.team_goals_for = 2
    strong.team_goals_conceded = 0
    strong.team_expected_goals_conceded = 0.55

    base_rating, _ = calculate_def_rating(base, config)
    strong_rating, _ = calculate_def_rating(strong, config)

    assert strong_rating > base_rating


def test_cb_context_penalizes_heavy_concession_without_dominating():
    config = load_position_config("DEF")
    base = _neutral_cb()
    base.team_goals_for = 1
    base.team_goals_conceded = 1
    base.team_expected_goals_conceded = 1.0
    base.team_big_chances_conceded = 1

    exposed = deepcopy(base)
    exposed.team_goals_for = 0
    exposed.team_goals_conceded = 4
    exposed.team_expected_goals_conceded = 2.6
    exposed.team_big_chances_conceded = 5

    base_rating, _ = calculate_def_rating(base, config)
    exposed_rating, _ = calculate_def_rating(exposed, config)

    assert exposed_rating < base_rating
    assert base_rating - exposed_rating <= 0.4


def test_defender_direct_mistakes_are_penalized():
    config = load_position_config("DEF")
    base = _neutral_cb()
    mistake = deepcopy(base)
    mistake.penalty_conceded = 1
    mistake.own_goals = 1

    base_rating, _ = calculate_def_rating(base, config)
    mistake_rating, _ = calculate_def_rating(mistake, config)

    assert mistake_rating < base_rating
