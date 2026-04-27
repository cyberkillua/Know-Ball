import unittest

from pipeline.engine.calculator import PlayerMatchStats
from pipeline.engine.cam_calculator import calc_carrying as calc_cam_carrying
from pipeline.engine.cm_calculator import (
    _weights_for_role,
    calc_carrying as calc_cm_carrying,
    calc_volume_passing,
)


class MidfieldNewInputsTest(unittest.TestCase):
    def test_cm_carrying_uses_progressive_carry_distance(self):
        constants = {"progressive_carry_distance_weight": 0.002}
        base = PlayerMatchStats(touches=40)
        progressive = PlayerMatchStats(
            touches=40,
            total_progressive_ball_carries_distance=100,
        )

        self.assertGreater(
            calc_cm_carrying(progressive, constants),
            calc_cm_carrying(base, constants),
        )

    def test_cam_carrying_uses_progressive_carry_distance(self):
        constants = {"progressive_carry_distance_weight": 0.002}
        base = PlayerMatchStats(touches=40)
        progressive = PlayerMatchStats(
            touches=40,
            total_progressive_ball_carries_distance=100,
        )

        self.assertGreater(
            calc_cam_carrying(progressive, constants),
            calc_cam_carrying(base, constants),
        )

    def test_cm_volume_passing_uses_pass_value_normalized(self):
        constants = {"pass_value_weight": 0.6, "pass_volume_reward": 0.015}
        base = PlayerMatchStats(passes_completed=40)
        valuable = PlayerMatchStats(
            passes_completed=40,
            pass_value_normalized=1.0,
        )

        self.assertGreater(
            calc_volume_passing(valuable, constants),
            calc_volume_passing(base, constants),
        )

    def test_cm_volume_passing_uses_forward_pass_proxies(self):
        constants = {
            "pass_value_weight": 0.6,
            "opposition_half_pass_reward": 0.008,
            "accurate_long_ball_reward": 0.025,
        }
        base = PlayerMatchStats(pass_value_normalized=0.2)
        progressive = PlayerMatchStats(
            pass_value_normalized=0.2,
            accurate_opposition_half_passes=20,
            total_opposition_half_passes=28,
            accurate_long_balls=4,
            total_long_balls=6,
        )

        self.assertGreater(
            calc_volume_passing(progressive, constants),
            calc_volume_passing(base, constants),
        )

    def test_cdm_weights_reduce_goal_threat_dependence(self):
        weights = {
            "volume_passing": 0.2,
            "carrying": 0.2,
            "chance_creation": 0.25,
            "defensive": 0.2,
            "goal_threat": 0.15,
        }

        cdm_weights = _weights_for_role(weights, "CDM")

        self.assertLess(cdm_weights["goal_threat"], weights["goal_threat"])
        self.assertGreater(cdm_weights["volume_passing"], weights["volume_passing"])
        self.assertGreater(cdm_weights["defensive"], weights["defensive"])


if __name__ == "__main__":
    unittest.main()
