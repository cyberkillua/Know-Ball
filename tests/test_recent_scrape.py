import unittest
from datetime import datetime, timezone
from unittest.mock import patch

import pipeline.scrape as scrape
from pipeline.scrapers import sofascore


class FixedDateTime:
    @staticmethod
    def now(tz=None):
        return datetime(2026, 4, 28, tzinfo=timezone.utc)

    @staticmethod
    def fromtimestamp(timestamp, tz=None):
        return datetime.fromtimestamp(timestamp, tz=tz)


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

    def test_recent_scrape_dedupes_events_returned_on_multiple_dates(self):
        processed_matches = []
        event = {
            "id": 123,
            "status": {"type": "finished"},
            "tournament": {"uniqueTournament": {"id": 17}},
            "homeTeam": {"name": "Home", "id": 1},
            "awayTeam": {"name": "Away", "id": 2},
            "homeScore": {"current": 1},
            "awayScore": {"current": 0},
            "roundInfo": {"round": 34},
            "startTimestamp": 1777248000,
        }

        def fake_process_match(db, match, league_id, season):
            processed_matches.append(match)
            return True

        with (
            patch.object(scrape, "datetime", FixedDateTime),
            patch.object(scrape, "fetch_scheduled_events", return_value=[event]),
            patch.object(scrape, "get_league_id", return_value=1),
            patch.object(scrape, "_process_match", side_effect=fake_process_match),
            patch.object(scrape, "_backfill_understat_match_ids"),
            patch.object(scrape, "_update_understat_stats"),
        ):
            scrape.scrape_recent_matches(
                db=None,
                season="2025/2026",
                days=3,
                existing_ids=set(),
            )

        self.assertEqual(len(processed_matches), 1)


class ScheduledEventsTest(unittest.TestCase):
    def test_scheduled_event_fetch_errors_are_not_silently_empty(self):
        with patch.object(sofascore, "_api_get", side_effect=RuntimeError("blocked")):
            with self.assertRaises(RuntimeError):
                sofascore.fetch_scheduled_events("2026-04-27")

    def test_season_id_override_skips_season_lookup(self):
        with (
            patch.dict(
                "os.environ",
                {"SOFASCORE_SEASON_IDS": "17:2025/2026=76986"},
            ),
            patch.object(sofascore, "_season_id_override_cache", None),
            patch.object(sofascore, "list_available_seasons") as list_seasons,
        ):
            self.assertEqual(sofascore.get_season_id_by_name(17, "2025/2026"), 76986)
            list_seasons.assert_not_called()


if __name__ == "__main__":
    unittest.main()
