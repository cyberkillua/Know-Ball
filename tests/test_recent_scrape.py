import unittest
from datetime import datetime, timezone
from unittest.mock import patch

import pipeline.ingest.scrape as scrape
from pipeline.ingest.scrapers import sofascore


class FixedDateTime:
    @staticmethod
    def now(tz=None):
        return datetime(2026, 4, 28, tzinfo=timezone.utc)

    @staticmethod
    def fromtimestamp(timestamp, tz=None):
        return datetime.fromtimestamp(timestamp, tz=tz)


class RecentScrapeTest(unittest.TestCase):
    def test_world_cup_event_is_recognized(self):
        event = {
            "id": 456,
            "status": {"type": "finished"},
            "tournament": {"uniqueTournament": {"id": 16}},
            "homeTeam": {"name": "Nigeria", "id": 1},
            "awayTeam": {"name": "Argentina", "id": 2},
            "homeScore": {"current": 2},
            "awayScore": {"current": 1},
            "roundInfo": {"round": 1},
            "startTimestamp": 1781481600,
        }

        match = scrape._match_from_event(event)

        self.assertIsNotNone(match)
        self.assertEqual(match["fotmob_league_id"], 77)

    def test_unscoped_recent_scrape_skips_optional_world_cup(self):
        event = {
            "id": 456,
            "status": {"type": "finished"},
            "tournament": {"uniqueTournament": {"id": 16}},
            "homeTeam": {"name": "Nigeria", "id": 1},
            "awayTeam": {"name": "Argentina", "id": 2},
            "homeScore": {"current": 2},
            "awayScore": {"current": 1},
            "roundInfo": {"round": 1},
            "startTimestamp": 1781481600,
        }

        with (
            patch.object(scrape, "datetime", FixedDateTime),
            patch.object(scrape, "fetch_scheduled_events", return_value=[event]),
            patch.object(scrape, "_process_match") as process_match,
        ):
            scrape.scrape_recent_matches(
                db=None,
                season="2025/2026",
                days=1,
                existing_ids=set(),
            )

        process_match.assert_not_called()

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
            patch.object(scrape, "backfill_understat_match_ids"),
            patch.object(scrape, "update_understat_stats"),
        ):
            scrape.scrape_recent_matches(
                db=None,
                season="2025/2026",
                days=3,
                existing_ids=set(),
            )

        self.assertEqual(len(processed_matches), 1)


class ScheduledEventsTest(unittest.TestCase):
    def test_forbidden_api_errors_are_not_retried(self):
        error = sofascore.HTTPError("forbidden")
        error.response = type("Response", (), {"status_code": 403})()

        with patch.object(sofascore, "Session") as session:
            session.return_value.get.return_value.raise_for_status.side_effect = error
            with self.assertRaises(sofascore.HTTPError):
                sofascore._api_get("sport/football/scheduled-events/2026-04-27")

        session.return_value.get.assert_called_once()

    def test_sofascore_proxy_is_passed_to_requests(self):
        response = type(
            "Response",
            (),
            {"raise_for_status": lambda self: None, "json": lambda self: {"events": []}},
        )()

        with (
            patch.dict("os.environ", {"SOFASCORE_PROXY": "http://proxy.test:8080"}),
            patch.object(sofascore, "Session") as session,
        ):
            session.return_value.get.return_value = response
            sofascore._api_get("sport/football/scheduled-events/2026-04-27")

        self.assertEqual(
            session.return_value.get.call_args.kwargs["proxy"],
            "http://proxy.test:8080",
        )

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

    def test_known_world_cup_season_skips_season_lookup(self):
        with patch.object(sofascore, "list_available_seasons") as list_seasons:
            self.assertEqual(sofascore.get_season_id_by_name(16, "2026"), 58210)
            list_seasons.assert_not_called()


if __name__ == "__main__":
    unittest.main()
