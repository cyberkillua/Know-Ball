"""Shared league and season configuration for the data pipeline."""

from pipeline.scrapers.sofascore import TOURNAMENT_IDS

CURRENT_SEASON = "2025/2026"

LEAGUES = [
    ("Premier League", 47, "EPL"),
    ("Championship", 48, None),
    ("La Liga", 87, "La_liga"),
    ("Ligue 1", 53, "Ligue_1"),
    ("Serie A", 55, "Serie_A"),
    ("Bundesliga", 54, "Bundesliga"),
]

FOTMOB_ID_BY_TOURNAMENT_ID = {v: k for k, v in TOURNAMENT_IDS.items()}

