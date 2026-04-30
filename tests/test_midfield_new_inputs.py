import unittest

from pipeline.engine.calculator import PlayerMatchStats
from pipeline.engine.cam_calculator import calc_carrying as calc_cam_carrying
from pipeline.engine.cm_calculator import (
    _weights_for_role,
    calc_control,
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

    def test_cm_control_rewards_secure_match_level_possession(self):
        constants = {
            "control_pass_accuracy_threshold": 0.78,
            "control_pass_accuracy_weight": 0.35,
            "control_own_half_accuracy_threshold": 0.85,
            "control_own_half_accuracy_weight": 0.15,
            "control_possession_loss_penalty": 0.45,
        }
        loose = PlayerMatchStats(
            touches=45,
            passes_completed=24,
            passes_total=36,
            accurate_own_half_passes=10,
            total_own_half_passes=15,
            possession_lost_ctrl=10,
        )
        secure = PlayerMatchStats(
            touches=70,
            passes_completed=54,
            passes_total=60,
            accurate_own_half_passes=28,
            total_own_half_passes=30,
            possession_lost_ctrl=4,
        )

        self.assertGreater(calc_control(secure, constants), calc_control(loose, constants))

    def test_cdm_weights_reduce_goal_threat_dependence(self):
        weights = {
            "volume_passing": 0.18,
            "control": 0.17,
            "carrying": 0.18,
            "chance_creation": 0.22,
            "defensive": 0.18,
            "goal_threat": 0.07,
        }

        cdm_weights = _weights_for_role(weights, "CDM")

        self.assertLess(cdm_weights["goal_threat"], weights["goal_threat"])
        self.assertGreater(cdm_weights["volume_passing"], weights["volume_passing"])
        self.assertGreater(cdm_weights["control"], weights["control"])
        self.assertGreater(cdm_weights["defensive"], weights["defensive"])


if __name__ == "__main__":
    unittest.main()
