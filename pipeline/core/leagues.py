"""Shared league and season configuration for the data pipeline."""

from pipeline.core.settings import SETTINGS
from pipeline.ingest.scrapers.sofascore import TOURNAMENT_IDS

CURRENT_SEASON = SETTINGS.current_season

LEAGUES = [
    ("Premier League", 47, "EPL"),
    ("La Liga", 87, "La_liga"),
    ("Ligue 1", 53, "Ligue_1"),
    ("Serie A", 55, "Serie_A"),
    ("Bundesliga", 54, "Bundesliga"),
]

OPTIONAL_COMPETITIONS = [
    ("FIFA World Cup", 77, None),
]

ALL_COMPETITIONS = [*LEAGUES, *OPTIONAL_COMPETITIONS]

FOTMOB_ID_BY_TOURNAMENT_ID = {v: k for k, v in TOURNAMENT_IDS.items()}
