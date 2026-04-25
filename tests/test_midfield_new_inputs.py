import unittest

from pipeline.engine.calculator import PlayerMatchStats
from pipeline.engine.cam_calculator import calc_carrying as calc_cam_carrying
from pipeline.engine.cm_calculator import (
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


if __name__ == "__main__":
    unittest.main()
