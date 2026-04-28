import unittest

from pipeline.backfill_player_season_sofascore import _discover_targets


class FakeDB:
    def __init__(self):
        self.sql = ""
        self.params = ()

    def query(self, sql, params=()):
        self.sql = sql
        self.params = params
        return []


class DiscoverTargetsTest(unittest.TestCase):
    def test_default_discovery_skips_current_populated_rows(self):
        db = FakeDB()

        _discover_targets(db, fotmob_id=47, season="2025/2026")

        self.assertIn("LEFT JOIN player_season_sofascore", db.sql)
        self.assertIn("MAX(pss.fetched_at) IS NULL", db.sql)
        self.assertIn("MAX(pss.fetched_at) < MAX(m.date)::timestamp", db.sql)
        self.assertIn("NOW() - (%s * INTERVAL '1 day')", db.sql)
        self.assertEqual(db.params, (47, "2025/2026", 7))

    def test_no_skip_populated_forces_all_targets(self):
        db = FakeDB()

        _discover_targets(
            db,
            fotmob_id=47,
            season="2025/2026",
            skip_populated=False,
        )

        self.assertIn("HAVING TRUE", db.sql)
        self.assertEqual(db.params, (47, "2025/2026"))


if __name__ == "__main__":
    unittest.main()
