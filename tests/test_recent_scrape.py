import unittest
from datetime import datetime, timezone
from unittest.mock import patch

import pipeline.scrape as scrape


class FixedDateTime:
    @staticmethod
    def now(tz=None):
        return datetime(2026, 4, 28, tzinfo=timezone.utc)


class RecentScrapeTest(unittest.TestCase):
    def test_recent_scrape_checks_each_day_in_lookback_window(self):
        fetched_dates = []

        def fake_fetch_scheduled_events(date_str):
            fetched_dates.append(date_str)
            return []

        with (
            patch.object(scrape, "datetime", FixedDateTime),
            patch.object(scrape, "fetch_scheduled_events", fake_fetch_scheduled_events),
        ):
            scrape.scrape_recent_matches(
                db=None,
                season="2025/2026",
                days=3,
                existing_ids=set(),
            )

        self.assertEqual(
            fetched_dates,
            ["2026-04-27", "2026-04-26", "2026-04-25"],
        )


if __name__ == "__main__":
    unittest.main()
