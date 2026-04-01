"""
Understat scraper.

Fetches per-shot data from understat.com.
Data is embedded as encoded JSON inside <script> tags on each page.

Coverage: EPL, La Liga, Ligue 1, Serie A, Bundesliga (no Championship).
"""

import json
import re
import time
import httpx
from bs4 import BeautifulSoup
from tenacity import retry, stop_after_attempt, wait_exponential

from pipeline.logger import get_logger

log = get_logger("understat")

BASE_URL = "https://understat.com"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                  "AppleWebKit/537.36 (KHTML, like Gecko) "
                  "Chrome/120.0.0.0 Safari/537.36",
}
REQUEST_DELAY = 3

# Understat league slugs
LEAGUE_SLUGS = {
    "EPL": "EPL",
    "La_liga": "La_liga",
    "Ligue_1": "Ligue_1",
    "Serie_A": "Serie_A",
    "Bundesliga": "Bundesliga",
}


def _decode_data(encoded: str) -> str:
    """Decode Understat's hex-encoded JSON strings."""
    # Understat encodes special chars as hex: \\xHH
    return encoded.encode("utf-8").decode("unicode_escape")


def _extract_json_var(html: str, var_name: str) -> list | dict:
    """
    Extract a JSON variable from an Understat page's embedded scripts.

    Understat embeds data like:
        var datesData = JSON.parse('...');
    """
    pattern = rf"var\s+{var_name}\s*=\s*JSON\.parse\('(.+?)'\)"
    match = re.search(pattern, html)
    if not match:
        raise ValueError(f"Could not find variable '{var_name}' in page")

    raw = match.group(1)
    decoded = _decode_data(raw)
    return json.loads(decoded)


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=5, max=30))
def _fetch_page(path: str) -> str:
    """Fetch an Understat page and return its HTML."""
    url = f"{BASE_URL}/{path}"
    with httpx.Client(headers=HEADERS, timeout=30, follow_redirects=True) as client:
        resp = client.get(url)
        resp.raise_for_status()
        return resp.text


def fetch_league_matches(slug: str, season: int) -> list[dict]:
    """
    Fetch match list for a league season.

    Args:
        slug: Understat league slug (e.g. "EPL")
        season: Starting year of season (e.g. 2025 for 2025/26)

    Returns:
        List of match dicts with id, date, home/away teams and scores.
    """
    log.info(f"Fetching Understat matches for {slug} {season}")
    html = _fetch_page(f"league/{slug}/{season}")

    # Extract dates/match data
    matches_data = _extract_json_var(html, "datesData")

    matches = []
    for m in matches_data:
        if not m.get("isResult", False):
            continue
        matches.append({
            "understat_id": int(m["id"]),
            "date": m.get("datetime", "")[:10],
            "home_team": m.get("h", {}).get("title", ""),
            "home_team_id": int(m.get("h", {}).get("id", 0)),
            "home_score": int(m.get("goals", {}).get("h", 0)),
            "away_team": m.get("a", {}).get("title", ""),
            "away_team_id": int(m.get("a", {}).get("id", 0)),
            "away_score": int(m.get("goals", {}).get("a", 0)),
        })

    log.info(f"Found {len(matches)} completed matches")
    time.sleep(REQUEST_DELAY)
    return matches


def fetch_match_shots(match_id: int) -> list[dict]:
    """
    Fetch per-shot data for a specific match.

    Returns a list of shot dicts with:
        id, minute, result, X, Y, xG, player, player_id,
        situation, shotType, match_id, player_assisted, lastAction
    """
    log.info(f"Fetching Understat shots for match {match_id}")
    html = _fetch_page(f"match/{match_id}")

    # Understat embeds shot data as "shotsData"
    shots_data = _extract_json_var(html, "shotsData")

    shots = []
    # shotsData is typically {"h": [...], "a": [...]}
    if isinstance(shots_data, dict):
        all_shots = shots_data.get("h", []) + shots_data.get("a", [])
    elif isinstance(shots_data, list):
        all_shots = shots_data
    else:
        all_shots = []

    for s in all_shots:
        shots.append({
            "understat_id": int(s.get("id", 0)),
            "minute": int(s.get("minute", 0)),
            "x": float(s.get("X", 0)),
            "y": float(s.get("Y", 0)),
            "xg": float(s.get("xG", 0)),
            "result": s.get("result", ""),
            "shot_type": s.get("shotType", ""),
            "situation": s.get("situation", ""),
            "last_action": s.get("lastAction", ""),
            "player": s.get("player", ""),
            "player_id": int(s.get("player_id", 0)),
            "player_assisted": s.get("player_assisted", ""),
            "home_away": s.get("h_a", ""),
        })

    log.info(f"Extracted {len(shots)} shots")
    time.sleep(REQUEST_DELAY)
    return shots


def fetch_player_shots(player_id: int) -> list[dict]:
    """
    Fetch all shots for a specific player (all seasons).
    Useful for backfill/deep analysis.
    """
    log.info(f"Fetching Understat shots for player {player_id}")
    html = _fetch_page(f"player/{player_id}")
    shots_data = _extract_json_var(html, "shotsData")

    shots = []
    if isinstance(shots_data, list):
        for s in shots_data:
            shots.append({
                "understat_id": int(s.get("id", 0)),
                "minute": int(s.get("minute", 0)),
                "x": float(s.get("X", 0)),
                "y": float(s.get("Y", 0)),
                "xg": float(s.get("xG", 0)),
                "result": s.get("result", ""),
                "shot_type": s.get("shotType", ""),
                "situation": s.get("situation", ""),
                "last_action": s.get("lastAction", ""),
                "match_id": int(s.get("match_id", 0)),
                "player_assisted": s.get("player_assisted", ""),
                "season": s.get("season", ""),
            })

    log.info(f"Extracted {len(shots)} shots for player {player_id}")
    time.sleep(REQUEST_DELAY)
    return shots
