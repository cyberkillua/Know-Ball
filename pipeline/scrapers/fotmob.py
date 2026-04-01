"""
FotMob scraper.

Fetches match lists and per-player match stats from FotMob by parsing
the __NEXT_DATA__ JSON embedded in server-rendered pages.
"""

import json
import re
import time
import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from pipeline.logger import get_logger

log = get_logger("fotmob")

BASE_URL = "https://www.fotmob.com"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                  "AppleWebKit/537.36 (KHTML, like Gecko) "
                  "Chrome/120.0.0.0 Safari/537.36",
}
REQUEST_DELAY = 3

# FotMob league URL slugs
LEAGUE_SLUGS = {
    47: "premier-league",
    48: "championship",
    87: "la-liga",
    53: "ligue-1",
    55: "serie-a",
    54: "bundesliga",
}


def _extract_next_data(html: str) -> dict:
    """Extract __NEXT_DATA__ JSON from a FotMob page."""
    match = re.search(
        r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>',
        html,
    )
    if not match:
        raise ValueError("Could not find __NEXT_DATA__ in page")
    return json.loads(match.group(1))


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=5, max=30))
def _fetch_page(path: str) -> str:
    """Fetch a FotMob page and return HTML."""
    url = f"{BASE_URL}/{path}"
    with httpx.Client(headers=HEADERS, timeout=30, follow_redirects=True) as client:
        resp = client.get(url)
        resp.raise_for_status()
        return resp.text


def fetch_league_matches(league_id: int, season: str) -> list[dict]:
    """
    Fetch all completed matches for a league season.

    Args:
        league_id: FotMob league ID (e.g. 47 for PL)
        season: Season string like "2025/2026"

    Returns:
        List of match dicts.
    """
    slug = LEAGUE_SLUGS.get(league_id, "league")
    log.info(f"Fetching matches for league {league_id} ({slug}), season {season}")

    html = _fetch_page(f"leagues/{league_id}/overview/{slug}")
    data = _extract_next_data(html)
    props = data["props"]["pageProps"]
    fixtures = props.get("fixtures", {})
    all_matches = fixtures.get("allMatches", [])

    matches = []
    for m in all_matches:
        status = m.get("status", {})
        if not status.get("finished", False):
            continue

        home = m.get("home", {})
        away = m.get("away", {})

        # Parse score from scoreStr "2 - 1"
        score_str = status.get("scoreStr", "")
        home_score, away_score = None, None
        if " - " in score_str:
            parts = score_str.split(" - ")
            try:
                home_score = int(parts[0])
                away_score = int(parts[1])
            except ValueError:
                pass

        matches.append({
            "fotmob_id": int(m.get("id", 0)),
            "date": status.get("utcTime", "")[:10],
            "matchday": int(m.get("round", 0)) if m.get("round") else None,
            "home_team": home.get("name", ""),
            "home_team_id": int(home.get("id", 0)),
            "home_score": home_score,
            "away_team": away.get("name", ""),
            "away_team_id": int(away.get("id", 0)),
            "away_score": away_score,
            "page_url": m.get("pageUrl", ""),
        })

    log.info(f"Found {len(matches)} completed matches")
    time.sleep(REQUEST_DELAY)
    return matches


def fetch_match_details(
    match_id: int,
    page_url: str = "",
    expected_date: str = "",
    expected_home: str = "",
    expected_away: str = "",
) -> dict:
    """
    Fetch detailed match data including player stats.

    FotMob's pageUrl slugs resolve to the LATEST match between two teams,
    not necessarily the one we want. We validate the returned match against
    expected metadata to prevent storing wrong data (e.g. cup game data
    for a league match).

    Args:
        match_id: FotMob match ID from the league fixture list
        page_url: Page URL path from the match list
        expected_date: Expected match date (YYYY-MM-DD) for validation
        expected_home: Expected home team name
        expected_away: Expected away team name

    Returns:
        The pageProps content dict, or empty dict if validation fails.
    """
    log.info(f"Fetching match details for {match_id}")

    if page_url:
        path = page_url.lstrip("/")
    else:
        path = f"matches/{match_id}"

    html = _fetch_page(path)
    data = _extract_next_data(html)
    page_props = data["props"]["pageProps"]

    # Validate: ensure the returned page matches the expected match
    general = page_props.get("general", {})
    returned_date = general.get("matchTimeUTCDate", "")[:10]

    if expected_date and returned_date and returned_date != expected_date:
        log.warning(
            f"Match {match_id}: URL returned wrong match! "
            f"Expected date {expected_date}, got {returned_date} "
            f"(likely a different fixture between same teams). Skipping details."
        )
        time.sleep(REQUEST_DELAY)
        return {}

    # Also validate via league — if general has leagueName, check it's not a cup
    returned_league = general.get("leagueName", "")
    league_id = general.get("parentLeagueId")
    if returned_league and "cup" in returned_league.lower():
        log.warning(
            f"Match {match_id}: URL returned a cup match ({returned_league}) "
            f"instead of league match. Skipping details."
        )
        time.sleep(REQUEST_DELAY)
        return {}

    time.sleep(REQUEST_DELAY)
    return page_props.get("content", {})


def _build_lineup_position_map(content: dict) -> dict[int, str]:
    """
    Build a map of player_id → lineup position role from the match lineup data.

    FotMob uses a numeric positionId and x/y pitch coordinates.
    We derive specific positions (ST, LW, RW, CAM, CM, CB, LB, RB, GK)
    from the horizontal layout x (how far forward) and y (how wide).

    x ≈ 0.10 → GK
    x ≈ 0.29-0.36 → Defenders (y determines LB/CB/RB)
    x ≈ 0.48 → Central midfielders
    x ≈ 0.61-0.68 → Attacking midfielders / wide players
    x ≈ 0.87 → Forwards (y ≈ 0.5 = ST, extreme y = winger)
    """
    pos_map: dict[int, str] = {}
    lineup = content.get("lineup", {})

    for team_key in ("homeTeam", "awayTeam"):
        team = lineup.get(team_key, {})

        # 1) Collect all starter coordinates first
        starter_data: list[tuple[int, float, float, dict]] = []  # (pid, x, y, player)
        for player in team.get("starters", []):
            pid = player.get("id")
            if not pid:
                continue
            hl = player.get("horizontalLayout", {})
            x = hl.get("x", 0)
            y = hl.get("y", 0.5)
            starter_data.append((int(pid), x, y, player))

        # Group players by x-band to detect formation shape (e.g. front 3 vs front 2)
        forward_line = [(pid, x, y, p) for pid, x, y, p in starter_data if x > 0.75]

        # 2) Classify starters
        starter_positions: dict[int, str] = {}   # pid → position
        sub_out_map: dict[int, list[int]] = {}    # minute → [starter pids who went off]

        for pid, x, y, player in starter_data:
            if x > 0.75 and len(forward_line) >= 3:
                # Front 3+: only the most central player(s) are ST, wide ones are wingers
                # Sort by distance from centre (y=0.5)
                sorted_fwd = sorted(forward_line, key=lambda f: abs(f[2] - 0.5))
                central_pids = {sorted_fwd[0][0]}  # closest to center = ST
                # If 4 forwards (rare), maybe 2 central
                if len(forward_line) >= 4:
                    central_pids.add(sorted_fwd[1][0])

                if pid in central_pids:
                    pos = "ST"
                elif y >= 0.5:
                    pos = "RW"
                else:
                    pos = "LW"
            elif x > 0.75 and len(forward_line) == 2:
                # Front 2: both are strikers (partnership)
                pos = "ST"
            else:
                pos = _classify_position(x, y)

            pos_map[pid] = pos
            starter_positions[pid] = pos

            # Track when this starter was subbed off
            perf = player.get("performance", {})
            for ev in perf.get("substitutionEvents", []):
                if ev.get("type") == "subOut":
                    minute = ev.get("time", 0)
                    sub_out_map.setdefault(minute, []).append(pid)

        # 2) Subs: inherit position from the starter they replaced (matched by minute)
        for player in team.get("subs", []):
            pid = player.get("id")
            if not pid:
                continue
            pid = int(pid)

            # Find which minute this sub came on
            perf = player.get("performance", {})
            sub_in_minute = None
            for ev in perf.get("substitutionEvents", []):
                if ev.get("type") == "subIn":
                    sub_in_minute = ev.get("time", 0)
                    break

            # Try to inherit position from a starter subbed off at the same minute
            inherited = None
            if sub_in_minute is not None and sub_in_minute in sub_out_map:
                available = sub_out_map[sub_in_minute]
                if available:
                    replaced_pid = available.pop(0)  # FIFO — take first available
                    inherited = starter_positions.get(replaced_pid)

            if inherited:
                pos_map[pid] = inherited
            else:
                # Fallback: generic position
                usual = player.get("usualPlayingPositionId")
                fallback = {0: "GK", 1: "CB", 2: "CM", 3: "ST"}.get(usual, "CM")
                pos_map[pid] = fallback

    return pos_map


def _classify_position(x: float, y: float) -> str:
    """Classify a player's position from their pitch coordinates.

    Thresholds tuned for both back-4 (DEF x≈0.29) and back-3 (DEF x≈0.36)
    formations, and for two-striker systems (STs at y≈0.30/0.70).
    """
    if x <= 0.15:
        return "GK"

    if x <= 0.40:
        # Defenders — covers back-4 (x≈0.29) and back-3 (x≈0.36)
        if y >= 0.75:
            return "RB"
        elif y <= 0.25:
            return "LB"
        else:
            return "CB"

    if x <= 0.58:
        # Central midfielders
        if y >= 0.80:
            return "RM"
        elif y <= 0.20:
            return "LM"
        else:
            return "CM"

    if x <= 0.75:
        # Attacking midfielders / wide
        if y >= 0.75:
            return "RW"
        elif y <= 0.25:
            return "LW"
        else:
            return "CAM"

    # Forwards (x > 0.75)
    # Wider ST band to capture two-striker formations (y≈0.30 and y≈0.70)
    if y >= 0.80:
        return "RW"
    elif y <= 0.20:
        return "LW"
    else:
        return "ST"


def extract_player_stats(content: dict) -> list[dict]:
    """
    Extract per-player stats from a FotMob match detail content dict.

    The stats live under content["playerStats"], keyed by player ID.
    Each player has a "stats" array of sections, each section has a "stats" dict.
    """
    player_stats_map = content.get("playerStats", {})
    if not player_stats_map:
        log.warning("No playerStats found in match content")
        return []

    # Build lineup position map for granular positions
    lineup_pos = _build_lineup_position_map(content)

    players = []
    for pid_str, pdata in player_stats_map.items():
        stats = _flatten_player_stats(pdata)
        if stats and stats.get("minutes_played", 0) > 0:
            # Override generic position with lineup-specific position if available
            pid = stats.get("fotmob_player_id")
            if pid and pid in lineup_pos:
                stats["position_played"] = lineup_pos[pid]
            players.append(stats)

    log.info(f"Extracted stats for {len(players)} players")
    return players


def _flatten_player_stats(pdata: dict) -> dict | None:
    """Flatten a single player's nested stat sections into a flat dict."""
    player_id = pdata.get("id")
    if not player_id:
        return None

    # Flatten all stat sections into one dict keyed by stat key
    flat = {}
    for section in pdata.get("stats", []):
        for stat_name, stat_obj in section.get("stats", {}).items():
            key = stat_obj.get("key", "")
            if not key:
                continue
            stat_val = stat_obj.get("stat", {})
            value = stat_val.get("value")
            total = stat_val.get("total")
            flat[key] = {"value": value, "total": total}

    def _int(key: str, default: int = 0) -> int:
        v = flat.get(key, {}).get("value", default)
        try:
            return int(v) if v is not None else default
        except (TypeError, ValueError):
            return default

    def _float(key: str, default: float = 0.0) -> float:
        v = flat.get(key, {}).get("value", default)
        try:
            return float(v) if v is not None else default
        except (TypeError, ValueError):
            return default

    def _fraction_won(key: str) -> tuple[int, int]:
        """For stats like 'ground_duels_won': value=won, total=total."""
        entry = flat.get(key, {})
        won = entry.get("value", 0)
        total = entry.get("total", 0)
        try:
            return int(won or 0), int(total or 0)
        except (TypeError, ValueError):
            return 0, 0

    # Duels
    ground_won, ground_total = _fraction_won("ground_duels_won")
    ground_lost = max(0, ground_total - ground_won)
    aerial_won, aerial_total = _fraction_won("aerials_won")
    aerial_lost = max(0, aerial_total - aerial_won)

    # Passes
    passes_completed = _int("accurate_passes")
    passes_total = flat.get("accurate_passes", {}).get("total", 0)
    try:
        passes_total = int(passes_total or 0)
    except (TypeError, ValueError):
        passes_total = 0

    return {
        "fotmob_player_id": player_id,
        "name": pdata.get("name", ""),
        "team_id": pdata.get("teamId"),
        "position_played": str(pdata.get("usualPosition", "")),
        "minutes_played": _int("minutes_played"),
        "goals": _int("goals"),
        "shots_total": _int("ShotsOnTarget") + _int("ShotsOffTarget"),
        "shots_on_target": _int("ShotsOnTarget"),
        "shots_off_target": _int("ShotsOffTarget"),
        "xg": _float("expected_goals"),
        "xgot": _float("expected_goals_on_target_variant"),
        "assists": _int("assists"),
        "xa": _float("expected_assists"),
        "key_passes": _int("chances_created"),
        "touches": _int("touches"),
        "passes_total": passes_total,
        "passes_completed": passes_completed,
        "successful_dribbles": _int("successful_dribbles"),
        "failed_dribbles": _int("dispossessed"),
        "fouls_won": _int("was_fouled"),
        "aerial_duels_won": aerial_won,
        "aerial_duels_lost": aerial_lost,
        "ground_duels_won": ground_won,
        "ground_duels_lost": ground_lost,
        "tackles_won": _int("matchstats.headers.tackles"),
        "interceptions": _int("interceptions"),
        "offsides": _int("offsides"),
        "fouls_committed": _int("fouls"),
        "yellow_cards": _int("yellow_card"),
        "red_cards": _int("red_card"),
        "fotmob_rating": _float("rating_title"),
    }
