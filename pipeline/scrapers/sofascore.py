"""
Sofascore scraper - Optimized version.

Fetches match lists and per-player match stats from Sofascore's API.
Uses curl_cffi with Chrome impersonation to bypass bot detection.

Optimizations:
- In-memory player profile caching
- Concurrent API calls with rate limiting
- Reduced delays for better throughput
- Graceful error handling for optional data
"""

import asyncio
import time
from curl_cffi.requests import AsyncSession, Session
from curl_cffi.requests.exceptions import HTTPError
from datetime import datetime
from tenacity import retry, stop_after_attempt, wait_exponential, wait_random

from pipeline.logger import get_logger

log = get_logger("sofascore")

BASE_URL = "https://www.sofascore.com/api/v1"
REQUEST_DELAY = 2.0

SOFASCORE_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Referer": "https://www.sofascore.com/",
    "Origin": "https://www.sofascore.com",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
}

TOURNAMENT_IDS = {
    47: 17,
    48: 18,
    87: 8,
    53: 34,
    55: 23,
    54: 35,
}

_POSITIONS_DETAILED_MAP = {
    "GK": "GK",
    "DC": "CB",
    "DL": "LB",
    "DR": "RB",
    "CB": "CB",
    "LB": "LB",
    "RB": "RB",
    "RWB": "RWB",
    "LWB": "LWB",
    "DM": "CDM",
    "DMC": "CDM",
    "MC": "CM",
    "MR": "RM",
    "ML": "LM",
    "AM": "CAM",
    "AMC": "CAM",
    "RW": "RW",
    "LW": "LW",
    "CF": "ST",
    "ST": "ST",
    "SS": "ST",
    "G": "GK",
}

_POS_LINE_ORDER = {"G": 0, "D": 1, "M": 2, "F": 3}

# Tactical line number for detailed positions (used for cost-based slot matching)
_POS_LINE = {
    "GK": 0,
    "CB": 1,
    "LB": 1,
    "RB": 1,
    "LWB": 1,
    "RWB": 1,
    "CDM": 2,
    "CM": 2,
    "LM": 2,
    "RM": 2,
    "CAM": 3,
    "LW": 3,
    "RW": 3,
    "CF": 4,
    "ST": 4,
}

# Positionally adjacent positions (one step away tactically)
_POS_ADJACENCY: dict[str, frozenset] = {
    "GK": frozenset(),
    "CB": frozenset({"CDM", "LB", "RB"}),
    "LB": frozenset({"CB", "LM", "LWB"}),
    "RB": frozenset({"CB", "RM", "RWB"}),
    "LWB": frozenset({"LB", "LM"}),
    "RWB": frozenset({"RB", "RM"}),
    "CDM": frozenset({"CM", "CB"}),
    "CM": frozenset({"CDM", "CAM", "LM", "RM"}),
    "LM": frozenset({"LW", "CM", "LB"}),
    "RM": frozenset({"RW", "CM", "RB"}),
    "CAM": frozenset({"CF", "CM", "LW", "RW"}),
    "LW": frozenset({"ST", "LM", "CAM"}),
    "RW": frozenset({"ST", "RM", "CAM"}),
    "CF": frozenset({"ST", "CAM"}),
    "ST": frozenset({"CF", "LW", "RW"}),
}

_player_cache: dict[int, dict] = {}
_season_cache: dict[
    int, list[dict]
] = {}  # tournament_id -> [{"id": 123, "name": "2024/2025"}, ...]


class RateLimiter:
    def __init__(self, rate: float = 2.0, burst: int = 10):
        self.rate = rate
        self.burst = burst
        self.tokens = burst
        self.last_update = time.time()
        self._lock: asyncio.Lock | None = None
        self._lock_loop: asyncio.AbstractEventLoop | None = None

    async def acquire_async(self):
        loop = asyncio.get_running_loop()
        if self._lock is None or self._lock_loop is not loop:
            self._lock = asyncio.Lock()
            self._lock_loop = loop
        async with self._lock:
            now = time.time()
            elapsed = now - self.last_update
            self.tokens = min(self.burst, self.tokens + elapsed * self.rate)
            self.last_update = now

            if self.tokens < 1:
                sleep_time = (1 - self.tokens) / self.rate
                await asyncio.sleep(sleep_time)
                self.tokens = 0
            else:
                self.tokens -= 1

    def acquire_sync(self):
        now = time.time()
        elapsed = now - self.last_update
        self.tokens = min(self.burst, self.tokens + elapsed * self.rate)
        self.last_update = now

        if self.tokens < 1:
            sleep_time = (1 - self.tokens) / self.rate
            time.sleep(sleep_time)
            self.tokens = 0
        else:
            self.tokens -= 1


_rate_limiter = RateLimiter(rate=1.0, burst=5)


async def _api_get_async(path: str, session: AsyncSession) -> dict:
    url = f"{BASE_URL}/{path}"
    await _rate_limiter.acquire_async()
    resp = await session.get(
        url, impersonate="chrome", headers=SOFASCORE_HEADERS, timeout=30
    )
    resp.raise_for_status()
    return resp.json()


@retry(
    stop=stop_after_attempt(5),
    wait=wait_exponential(multiplier=2, min=10, max=60) + wait_random(0, 5),
    reraise=True,
)
def _api_get(path: str) -> dict:
    url = f"{BASE_URL}/{path}"
    _rate_limiter.acquire_sync()
    resp = Session().get(
        url, impersonate="chrome", headers=SOFASCORE_HEADERS, timeout=30
    )
    resp.raise_for_status()
    return resp.json()


def _http_status_code(exc: Exception) -> int | None:
    response = getattr(exc, "response", None)
    return getattr(response, "status_code", None)


def _generate_season_alternatives(season_name: str) -> list[str]:
    """Generate alternative season name formats."""
    alternatives = []

    # Handle "2024/2025" format
    if "/" in season_name:
        parts = season_name.split("/")
        if len(parts) == 2:
            year1, year2 = parts[0].strip(), parts[1].strip()

            # Add short format: "24/25"
            if len(year1) == 4 and len(year2) == 4:
                alternatives.append(f"{year1[-2:]}/{year2[-2:]}")

            # Add dash format: "2024-2025"
            alternatives.append(f"{year1}-{year2}")

            # Add "24/25" expanded to full
            if len(year1) == 2 and len(year2) == 2:
                alternatives.append(f"20{year1}/20{year2}")

    # Handle "2024-2025" format
    elif "-" in season_name:
        parts = season_name.split("-")
        if len(parts) == 2:
            year1, year2 = parts[0].strip(), parts[1].strip()
            # Convert to slash format
            alternatives.append(f"{year1}/{year2}")
            if len(year1) == 4:
                alternatives.append(f"{year1[-2:]}/{year2[-2:]}")

    # Handle single year "2024"
    elif len(season_name) == 4 and season_name.isdigit():
        year = season_name
        next_year = str(int(year) + 1)
        # Try "2024/2025"
        alternatives.append(f"{year}/{next_year}")
        alternatives.append(f"{year[-2:]}/{next_year[-2:]}")

    return list(set(alternatives))


def _seasons_match(season1: str, season2: str) -> bool:
    """Check if two season names refer to the same season."""
    import re

    # Normalize both
    s1 = season1.replace("-", "/").strip()
    s2 = season2.replace("-", "/").strip()

    if s1 == s2:
        return True

    # Extract years
    def extract_years(s: str):
        match = re.search(r"(\d{2,4})[/\-](\d{2,4})", s)
        if match:
            y1, y2 = int(match.group(1)), int(match.group(2))
            if y1 < 100:
                y1 = 2000 + y1
            if y2 < 100:
                y2 = 2000 + y2
            return (y1, y2)
        match = re.search(r"(\d{4})", s)
        if match:
            year = int(match.group(1))
            return (year, year + 1)
        return None

    years1 = extract_years(s1)
    years2 = extract_years(s2)

    return years1 is not None and years2 is not None and years1 == years2


def list_available_seasons(tournament_id: int) -> list[dict]:
    """
    List all available seasons for a tournament.

    Returns list of dicts: [{"id": 123, "name": "2024/2025"}, ...]
    """
    if tournament_id in _season_cache:
        return _season_cache[tournament_id]

    data = _api_get(f"unique-tournament/{tournament_id}/seasons")
    seasons = data.get("seasons", [])
    result = [{"id": s.get("id"), "name": s.get("name", "")} for s in seasons]

    _season_cache[tournament_id] = result
    return result


def get_current_season_id(tournament_id: int) -> int | None:
    data = _api_get(f"unique-tournament/{tournament_id}/seasons")
    seasons = data.get("seasons", [])
    return seasons[0]["id"] if seasons else None


def get_season_id_by_name(tournament_id: int, season_name: str) -> int | None:
    """
    Find a season ID by name, supporting multiple formats.

    Formats supported:
    - "2024/2025" (full)
    - "24/25" (short)
    - "2024-2025" (alternative with dash)
    - "2024" (single year - tries both "2024" and "2024/2025")

    Returns season ID or None if not found.
    """
    seasons = list_available_seasons(tournament_id)
    if not seasons:
        log.error(f"No seasons found for tournament {tournament_id}")
        return None

    # Normalize season name
    season_name = season_name.strip()

    # Try exact match first
    for s in seasons:
        if s.get("name") == season_name:
            log.info(f"Found exact match: season '{season_name}' (ID: {s['id']})")
            return s["id"]

    # Try alternative formats
    alternatives = _generate_season_alternatives(season_name)
    for alt in alternatives:
        for s in seasons:
            if s.get("name") == alt:
                log.info(
                    f"Found alternative match: '{season_name}' → '{alt}' (ID: {s['id']})"
                )
                return s["id"]

    # Try partial matching (e.g., year in name)
    for s in seasons:
        name = s.get("name", "")
        if _seasons_match(season_name, name):
            log.info(f"Found fuzzy match: '{season_name}' ≈ '{name}' (ID: {s['id']})")
            return s["id"]

    # List available seasons for helpful error
    available_names = [s["name"] for s in seasons]
    log.error(
        f"Season '{season_name}' not found for tournament {tournament_id}. "
        f"Available seasons: {available_names}"
    )
    return None


def fetch_league_matches(fotmob_league_id: int, season: str) -> list[dict]:
    tournament_id = TOURNAMENT_IDS.get(fotmob_league_id)
    if not tournament_id:
        log.error(
            f"No Sofascore tournament mapping for FotMob league {fotmob_league_id}"
        )
        return []

    season_id = get_season_id_by_name(tournament_id, season)
    if not season_id:
        # Error already logged in get_season_id_by_name
        return []

    log.info(
        f"Fetching matches for tournament {tournament_id}, season {season_id} ({season})"
    )

    matches = []
    consecutive_forbidden = 0
    max_consecutive_forbidden = 2

    for round_num in range(1, 50):
        try:
            data = _api_get(
                f"unique-tournament/{tournament_id}/season/{season_id}/events/round/{round_num}"
            )
            consecutive_forbidden = 0
        except HTTPError as e:
            if _http_status_code(e) == 403:
                consecutive_forbidden += 1
                log.warning(
                    f"Round {round_num}: HTTP 403 Forbidden "
                    f"({consecutive_forbidden}/{max_consecutive_forbidden})"
                )
                if consecutive_forbidden >= max_consecutive_forbidden:
                    raise RuntimeError(
                        f"Too many 403 errors fetching tournament "
                        f"{tournament_id}, season {season_id}"
                    )
                time.sleep(10)
                continue

            log.info(f"Round {round_num}: no data ({e}), stopping")
            break
        except Exception as e:
            log.info(f"Round {round_num}: no data ({e}), stopping")
            break

        events = data.get("events", [])
        if not events:
            log.info(f"Round {round_num}: empty, stopping")
            break

        finished_count = 0
        for event in events:
            status = event.get("status", {})
            if status.get("type") != "finished":
                continue

            finished_count += 1
            home = event.get("homeTeam", {})
            away = event.get("awayTeam", {})
            home_score_obj = event.get("homeScore", {})
            away_score_obj = event.get("awayScore", {})

            ts = event.get("startTimestamp", 0)
            date_str = datetime.utcfromtimestamp(ts).strftime("%Y-%m-%d") if ts else ""

            matches.append(
                {
                    "sofascore_id": event["id"],
                    "fotmob_id": None,
                    "date": date_str,
                    "matchday": round_num,
                    "home_team": home.get("name", ""),
                    "home_team_id": home.get("id", 0),
                    "away_team": away.get("name", ""),
                    "away_team_id": away.get("id", 0),
                    "home_score": home_score_obj.get("current"),
                    "away_score": away_score_obj.get("current"),
                }
            )

        if finished_count == 0:
            log.info(f"Round {round_num}: 0 finished matches, stopping")
            break

        log.info(f"Round {round_num}: {finished_count} finished matches")
        time.sleep(REQUEST_DELAY)

    log.info(f"Found {len(matches)} completed matches total")
    return matches


def _infer_positions_from_formation(formation: str, players: list[dict]) -> list[str]:
    if not formation:
        return []

    lines = [int(x) for x in formation.split("-")]
    positions = ["GK"]

    num_def = lines[0] if lines else 4
    if num_def == 3:
        positions.extend(["CB", "CB", "CB"])
    elif num_def == 4:
        positions.extend(["RB", "CB", "CB", "LB"])
    elif num_def == 5:
        positions.extend(["RWB", "CB", "CB", "CB", "LWB"])
    else:
        positions.extend(["CB"] * num_def)

    remaining_lines = lines[1:]

    for i, num_players in enumerate(remaining_lines):
        is_last_line = i == len(remaining_lines) - 1

        if is_last_line:
            if num_players == 1:
                positions.append("ST")
            elif num_players == 2:
                positions.extend(["ST", "ST"])
            elif num_players == 3:
                positions.extend(["RW", "ST", "LW"])
            elif num_players == 4:
                positions.extend(["RW", "ST", "ST", "LW"])
            else:
                positions.extend(["ST"] * num_players)
        else:
            is_attacking = i == len(remaining_lines) - 2 and len(remaining_lines) >= 3

            if num_players == 1:
                positions.append("CAM" if is_attacking else "CM")
            elif num_players == 2:
                positions.extend(["CM", "CM"])
            elif num_players == 3:
                if is_attacking:
                    positions.extend(["RW", "CAM", "LW"])
                else:
                    positions.extend(["CM", "CM", "CM"])
            elif num_players == 4:
                if is_attacking:
                    positions.extend(["RM", "CAM", "CAM", "LM"])
                else:
                    positions.extend(["RM", "CM", "CM", "LM"])
            elif num_players == 5:
                positions.extend(["RM", "CM", "CM", "CM", "LM"])
            else:
                positions.extend(["CM"] * num_players)

    return positions


def _basic_pos(player: dict) -> str:
    for val in (player.get("position"), (player.get("player") or {}).get("position")):
        if val and str(val) in _POS_LINE_ORDER:
            return str(val)
    return "M"


def _position_cost(profile_pos: str | None, slot: str) -> int:
    """
    Cost of assigning a player with a known profile position to a formation slot.
    Lower is better. GK mismatches are penalised heavily to prevent swaps.
    """
    if not profile_pos:
        return 3  # no information — neutral
    if profile_pos == slot:
        return 0
    if slot in _POS_ADJACENCY.get(profile_pos, frozenset()):
        return 1
    if _POS_LINE.get(profile_pos) == _POS_LINE.get(slot):
        return 2
    if slot == "GK" or profile_pos == "GK":
        return 100
    return 5


def _assign_formation_positions(
    slots: list[str],
    starters: list[dict],
    profile_map: dict[int, str],
) -> dict[int, str]:
    """
    Match starters to formation slots using player profile positions.

    Players with known profile positions are assigned first so they anchor
    the best-fit slots, leaving the remaining slots to be filled by players
    without profile data. Shirt number is never used.

    Args:
        slots: Ordered slot names from _infer_positions_from_formation
        starters: Starter player dicts from the Sofascore lineup API
        profile_map: sofascore_id → stored profile position (e.g. "RW", "CDM")

    Returns:
        Dict mapping sofascore player_id → assigned position string
    """
    available = list(slots)
    result: dict[int, str] = {}

    # Process players with a known profile position first so they claim
    # their best-fit slots before unknowns fill the gaps.
    def sort_key(p: dict):
        pid = p.get("player", {}).get("id")
        has_profile = pid in profile_map
        return (0 if has_profile else 1, _POS_LINE_ORDER.get(_basic_pos(p), 2))

    for player in sorted(starters, key=sort_key):
        if not available:
            break
        pid = player.get("player", {}).get("id")
        profile_pos = profile_map.get(pid) if pid else None

        best_i = min(
            range(len(available)),
            key=lambda i: _position_cost(profile_pos, available[i]),
        )
        assigned = available.pop(best_i)
        if pid:
            result[pid] = assigned

    return result


def extract_player_stats(
    detail: dict,
    match_info: dict = None,
    profile_map: dict[int, str] | None = None,
) -> list[dict]:
    lineups = detail.get("lineups", {})
    incidents = detail.get("incidents", [])

    # Build penalty goals map from incidents
    penalty_goals_map: dict[int, int] = {}
    for inc in incidents:
        if inc.get("incidentType") == "goal" and inc.get("incidentClass") == "penalty":
            inc_pid = inc.get("player", {}).get("id")
            if inc_pid:
                penalty_goals_map[inc_pid] = penalty_goals_map.get(inc_pid, 0) + 1

    # Build np_xg and np_shots maps from shotmap
    np_xg_map: dict[int, float] = {}
    np_shots_map: dict[int, int] = {}
    for shot in detail.get("shotmap", []):
        shot_pid = shot.get("player", {}).get("id")
        if shot_pid and shot.get("situation") != "penalty":
            np_xg_map[shot_pid] = np_xg_map.get(shot_pid, 0.0) + (shot.get("xg") or 0.0)
            np_shots_map[shot_pid] = np_shots_map.get(shot_pid, 0) + 1

    sub_map_in_to_out = {}
    for inc in incidents:
        if inc.get("incidentType") == "substitution":
            player_in = inc.get("playerIn", {})
            player_out = inc.get("playerOut", {})
            if player_in.get("id") and player_out.get("id"):
                sub_map_in_to_out[player_in["id"]] = player_out["id"]

    card_map: dict[int, dict] = {}
    for inc in incidents:
        if inc.get("incidentType") == "card":
            pid = inc.get("player", {}).get("id")
            if not pid:
                continue
            if pid not in card_map:
                card_map[pid] = {"yellow_cards": 0, "red_cards": 0}
            card_class = inc.get("incidentClass", "")
            if card_class == "yellow":
                card_map[pid]["yellow_cards"] += 1
            elif card_class in ("red", "yellowRed"):
                card_map[pid]["red_cards"] += 1

    players = []

    for side in ("home", "away"):
        team_data = lineups.get(side, {})
        formation = team_data.get("formation", "")
        team_players = team_data.get("players", [])
        # Use match_info to get authoritative team ID — player.get("teamId") is
        # unreliable (often None or a stale transfer ID).
        if match_info:
            side_team_id = match_info["home_team_id"] if side == "home" else match_info["away_team_id"]
        else:
            side_team_id = None

        starters = [p for p in team_players if not p.get("substitute", False)]
        subs = [p for p in team_players if p.get("substitute", False)]

        formation_positions = _infer_positions_from_formation(formation, starters)
        starter_pos_map = _assign_formation_positions(
            formation_positions, starters, profile_map or {}
        )

        for idx, player in enumerate(team_players):
            stats = player.get("statistics", {})
            mins = stats.get("minutesPlayed", 0)
            if not mins or mins <= 0:
                continue

            player_info = player.get("player", {})
            pid = player_info.get("id")
            if not pid:
                continue

            is_sub = player.get("substitute", False)

            if not is_sub and pid in starter_pos_map:
                position = starter_pos_map[pid]
            elif is_sub:
                replaced_pid = sub_map_in_to_out.get(pid)
                if replaced_pid and replaced_pid in starter_pos_map:
                    position = starter_pos_map[replaced_pid]
                else:
                    position = {"G": "GK", "D": "CB", "M": "CM", "F": "ST"}.get(
                        _basic_pos(player), "CM"
                    )
            else:
                position = {"G": "GK", "D": "CB", "M": "CM", "F": "ST"}.get(
                    _basic_pos(player), "CM"
                )

            aerial_won = stats.get("aerialWon", 0) or 0
            aerial_lost = stats.get("aerialLost", 0) or 0
            duel_won = stats.get("duelWon", 0) or 0
            duel_lost = stats.get("duelLost", 0) or 0
            ground_duels_won = max(0, duel_won - aerial_won)
            ground_duels_lost = max(0, duel_lost - aerial_lost)

            cards = card_map.get(pid, {})

            player_data = {
                "sofascore_player_id": pid,
                "name": player_info.get("name", ""),
                "team_id": side_team_id if side_team_id is not None else player.get("teamId"),
                "basic_position": player.get("position", "M"),
                "minutes_played": mins,
                "goals": stats.get("goals", 0) or 0,
                "shots_total": stats.get("totalShots", 0) or 0,
                "shots_on_target": stats.get("onTargetScoringAttempt", 0) or 0,
                "shots_off_target": stats.get("shotOffTarget", 0) or 0,
                "xg": stats.get("expectedGoals", 0.0) or 0.0,
                "xgot": stats.get("expectedGoalsOnTarget", 0.0) or 0.0,
                "assists": stats.get("goalAssist", 0) or 0,
                "xa": stats.get("expectedAssists", 0.0) or 0.0,
                "key_passes": stats.get("keyPass", 0) or 0,
                "touches": stats.get("touches", 0) or 0,
                "passes_total": stats.get("totalPass", 0) or 0,
                "passes_completed": stats.get("accuratePass", 0) or 0,
                # Sofascore exposes dribble attempts as totalContest/wonContest.
                # dispossessed is a separate ball-loss stat, not failed dribbles.
                "successful_dribbles": stats.get("wonContest", 0) or 0,
                "failed_dribbles": max(
                    (stats.get("totalContest", 0) or 0) - (stats.get("wonContest", 0) or 0),
                    0,
                ),
                "fouls_won": stats.get("wasFouled", 0) or 0,
                "aerial_duels_won": aerial_won,
                "aerial_duels_lost": aerial_lost,
                "ground_duels_won": ground_duels_won,
                "ground_duels_lost": ground_duels_lost,
                "tackles_won": stats.get("wonTackle", 0) or 0,
                "interceptions": stats.get("interceptionWon", 0) or 0,
                "offsides": stats.get("totalOffside", 0) or 0,
                "fouls_committed": stats.get("fouls", 0) or 0,
                "yellow_cards": cards.get("yellow_cards", 0),
                "red_cards": cards.get("red_cards", 0),
                "sofascore_rating": stats.get("rating", 0.0) or 0.0,
                "total_cross": stats.get("totalCross", 0) or 0,
                "accurate_cross": stats.get("accurateCross", 0) or 0,
                "total_long_balls": stats.get("totalLongBalls", 0) or 0,
                "accurate_long_balls": stats.get("accurateLongBalls", 0) or 0,
                "big_chance_created": stats.get("bigChanceCreated", 0) or 0,
                "big_chance_missed": stats.get("bigChanceMissed", 0) or 0,
                "hit_woodwork": stats.get("hitWoodwork", 0) or 0,
                "blocked_scoring_attempt": stats.get("blockedScoringAttempt", 0) or 0,
                "clearances": stats.get("totalClearance", 0) or 0,
                "head_clearance": stats.get("headClearance", 0) or 0,
                "outfielder_block": stats.get("outfielderBlock", 0) or 0,
                "ball_recovery": stats.get("ballRecovery", 0) or 0,
                "error_lead_to_goal": stats.get("errorLeadToGoal", 0) or 0,
                "error_lead_to_shot": stats.get("errorLeadToShot", 0) or 0,
                "possession_lost_ctrl": stats.get("possessionLostCtrl", 0) or 0,
                "total_contest": stats.get("totalContest", 0) or 0,
                "penalty_won": stats.get("penaltyWon", 0) or 0,
                "penalty_conceded": stats.get("penaltyConceded", 0) or 0,
                "own_goals": stats.get("ownGoals", 0) or 0,
                "penalty_goals": penalty_goals_map.get(pid, 0),
                "np_xg": round(np_xg_map.get(pid, 0.0), 4),
                "np_shots": np_shots_map.get(pid, 0),
                "accurate_own_half_passes": stats.get("accurateOwnHalfPasses", 0) or 0,
                "total_own_half_passes": stats.get("totalOwnHalfPasses", 0) or 0,
                "accurate_opposition_half_passes": stats.get("accurateOppositionHalfPasses", 0) or 0,
                "total_opposition_half_passes": stats.get("totalOppositionHalfPasses", 0) or 0,
                "pass_value_normalized": stats.get("passValueNormalized"),
                "total_ball_carries_distance": stats.get("totalBallCarriesDistance", 0) or 0,
                "total_progressive_ball_carries_distance": stats.get("totalProgressiveBallCarriesDistance", 0) or 0,
            }

            if player.get("position") == "G":
                player_data["gk_stats"] = {
                    "saves": stats.get("saves", 0) or 0,
                    "punches": stats.get("punches", 0) or 0,
                    "goals_prevented": stats.get("goalsPrevented", 0.0) or 0.0,
                    "good_high_claim": stats.get("goodHighClaim", 0) or 0,
                    "saves_inside_box": stats.get("savedShotsInsideBox", 0) or 0,
                    "diving_save": stats.get("divingSave", 0) or 0,
                    "goals_conceded": stats.get("goalsConceded", 0) or 0,
                }

            players.append(player_data)

    log.info(f"Extracted stats for {len(players)} players")
    return players


def get_position_from_lineup(player_id: int, detail: dict) -> str | None:
    """
    Extract position for a player from lineup data.

    Args:
        player_id: Sofascore player ID
        detail: Match detail dict with 'lineups' and 'incidents' keys

    Returns:
        Position string (GK, CB, CM, ST, etc.) or None if not found
    """
    lineups = detail.get("lineups", {})
    incidents = detail.get("incidents", [])

    sub_map_in_to_out = {}
    for inc in incidents:
        if inc.get("incidentType") == "substitution":
            player_in = inc.get("playerIn", {})
            player_out = inc.get("playerOut", {})
            if player_in.get("id") and player_out.get("id"):
                sub_map_in_to_out[player_in["id"]] = player_out["id"]

    for side in ("home", "away"):
        team_data = lineups.get(side, {})
        formation = team_data.get("formation", "")
        team_players = team_data.get("players", [])

        starters = sorted(
            [p for p in team_players if not p.get("substitute", False)],
            key=lambda p: (
                _POS_LINE_ORDER.get(_basic_pos(p), 2),
                p.get("shirtNumber", 99),
            ),
        )

        formation_positions = _infer_positions_from_formation(formation, starters)

        for idx, player in enumerate(starters):
            pid = player.get("player", {}).get("id")
            if pid == player_id and idx < len(formation_positions):
                return formation_positions[idx]

        for player in team_players:
            if not player.get("substitute", False):
                continue
            pid = player.get("player", {}).get("id")
            if pid == player_id:
                replaced_pid = sub_map_in_to_out.get(player_id)
                if replaced_pid:
                    for idx, p in enumerate(starters):
                        if p.get("player", {}).get("id") == replaced_pid:
                            if idx < len(formation_positions):
                                return formation_positions[idx]
                basic_pos = player.get("position", "M")
                return {"G": "GK", "D": "CB", "M": "CM", "F": "ST"}.get(basic_pos, "CM")

    return None


def fetch_player_profile(player_id: int) -> dict | None:
    """
    Fetch player profile data from Sofascore.

    Returns dict with position (mapped or raw), or None on failure.
    If position not in _POSITIONS_DETAILED_MAP, returns raw position code.
    """
    if player_id in _player_cache:
        return _player_cache[player_id]

    try:
        data = _api_get(f"player/{player_id}")
        time.sleep(REQUEST_DELAY)
    except Exception as e:
        log.warning(f"Failed to fetch profile for player {player_id}: {e}")
        return None

    player = data.get("player", data)
    dob_ts = player.get("dateOfBirthTimestamp")
    dob = datetime.utcfromtimestamp(dob_ts).strftime("%Y-%m-%d") if dob_ts else None

    positions_detailed = player.get("positionsDetailed", [])
    position = None
    if positions_detailed and isinstance(positions_detailed, list):
        if positions_detailed:
            pos_code = positions_detailed[0]
            position = _POSITIONS_DETAILED_MAP.get(pos_code, pos_code)

    mv_raw = player.get("proposedMarketValueRaw") or {}
    profile = {
        "date_of_birth": dob,
        "height_cm": player.get("height"),
        "preferred_foot": player.get("preferredFoot"),
        "shirt_number": player.get("jerseyNumber"),
        "nationality": player.get("country", {}).get("name"),
        "position": position,
        "market_value": player.get("proposedMarketValue"),
        "market_value_currency": mv_raw.get("currency"),
        "contract_until": player.get("contractUntilTimestamp"),
    }

    _player_cache[player_id] = profile
    return profile


async def fetch_player_profiles_batch(
    player_ids: list[int], max_concurrent: int = 10
) -> dict[int, dict]:
    """
    Fetch multiple player profiles concurrently.

    Args:
        player_ids: List of Sofascore player IDs
        max_concurrent: Max concurrent requests (default 10)

    Returns:
        Dict mapping player_id to profile (or None if failed)
    """
    profiles = {}
    semaphore = asyncio.Semaphore(max_concurrent)

    async def fetch_one(pid: int, session: AsyncSession):
        async with semaphore:
            try:
                await _rate_limiter.acquire_async()
                resp = await session.get(
                    f"{BASE_URL}/player/{pid}", impersonate="chrome", timeout=30
                )
                if resp.status_code == 200:
                    data = resp.json()
                    player = data.get("player", data)

                    dob_ts = player.get("dateOfBirthTimestamp")
                    dob = (
                        datetime.utcfromtimestamp(dob_ts).strftime("%Y-%m-%d")
                        if dob_ts
                        else None
                    )

                    positions_detailed = player.get("positionsDetailed", [])
                    position = None
                    if positions_detailed and isinstance(positions_detailed, list):
                        if positions_detailed:
                            pos_code = positions_detailed[0]
                            position = _POSITIONS_DETAILED_MAP.get(pos_code, pos_code)

                    mv_raw = player.get("proposedMarketValueRaw") or {}
                    profiles[pid] = {
                        "date_of_birth": dob,
                        "height_cm": player.get("height"),
                        "preferred_foot": player.get("preferredFoot"),
                        "shirt_number": player.get("jerseyNumber"),
                        "nationality": player.get("country", {}).get("name"),
                        "position": position,
                        "market_value": player.get("proposedMarketValue"),
                        "market_value_currency": mv_raw.get("currency"),
                        "contract_until": player.get("contractUntilTimestamp"),
                    }
                    _player_cache[pid] = profiles[pid]
                else:
                    profiles[pid] = None
            except Exception as e:
                log.debug(f"Failed to fetch player {pid}: {e}")
                profiles[pid] = None

    async with AsyncSession() as session:
        tasks = [fetch_one(pid, session) for pid in player_ids]
        await asyncio.gather(*tasks)

    return profiles


async def fetch_match_details_async(event_id: int) -> dict:
    """Fetch match details with lineups and incidents concurrently."""
    async with AsyncSession() as session:

        async def fetch_lineups():
            return await _api_get_async(f"event/{event_id}/lineups", session)

        async def fetch_incidents():
            return await _api_get_async(f"event/{event_id}/incidents", session)

        try:
            lineups, incidents_data = await asyncio.gather(
                fetch_lineups(),
                fetch_incidents(),
            )
            return {
                "lineups": lineups,
                "incidents": incidents_data.get("incidents", []),
            }
        except Exception as e:
            log.warning(f"Failed to fetch details for event {event_id}: {e}")
            return {}


def fetch_match_details(event_id: int) -> dict:
    """Fetch detailed match data (lineups + incidents) from Sofascore."""
    try:
        lineups = _api_get(f"event/{event_id}/lineups")
        time.sleep(REQUEST_DELAY)
        incidents_data = _api_get(f"event/{event_id}/incidents")
        time.sleep(REQUEST_DELAY)
    except Exception as e:
        log.warning(f"Failed to fetch details for event {event_id}: {e}")
        return {}

    return {
        "lineups": lineups,
        "incidents": incidents_data.get("incidents", []),
    }


async def fetch_match_details_with_optional_async(event_id: int) -> dict:
    """Fetch match details plus stats/odds/shotmap concurrently."""
    async with AsyncSession() as session:

        async def fetch_lineups():
            return await _api_get_async(f"event/{event_id}/lineups", session)

        async def fetch_incidents():
            return await _api_get_async(f"event/{event_id}/incidents", session)

        async def fetch_stats():
            try:
                return await _api_get_async(f"event/{event_id}/statistics", session)
            except:
                return None

        async def fetch_odds():
            try:
                return await _api_get_async(f"event/{event_id}/odds/1/all", session)
            except:
                return None

        async def fetch_shotmap():
            try:
                return await _api_get_async(f"event/{event_id}/shotmap", session)
            except:
                return None

        lineups, incidents_data, stats, odds, shotmap = await asyncio.gather(
            fetch_lineups(),
            fetch_incidents(),
            fetch_stats(),
            fetch_odds(),
            fetch_shotmap(),
        )

        return {
            "lineups": lineups,
            "incidents": incidents_data.get("incidents", []),
            "statistics": stats,
            "odds": odds,
            "shotmap": shotmap.get("shotmap", []) if shotmap else [],
        }


def fetch_match_statistics(event_id: int) -> list[dict]:
    try:
        data = _api_get(f"event/{event_id}/statistics")
        time.sleep(REQUEST_DELAY)
    except Exception as e:
        log.warning(f"Failed to fetch statistics for event {event_id}: {e}")
        return []

    periods = data.get("statistics", [])
    all_period = None
    for period in periods:
        if period.get("period") == "ALL":
            all_period = period
            break

    if not all_period:
        log.warning(f"No ALL period stats for event {event_id}")
        return []

    home_stats = {}
    away_stats = {}
    for group in all_period.get("groups", []):
        for item in group.get("statisticsItems", []):
            key = item.get("key", "")
            home_stats[key] = item.get("homeValue", item.get("home"))
            away_stats[key] = item.get("awayValue", item.get("away"))

    def _parse_team(raw: dict) -> dict:
        def _int(key):
            val = raw.get(key, 0)
            if isinstance(val, str):
                if "/" in val:
                    try:
                        return int(val.split("/")[0])
                    except ValueError:
                        return 0
                try:
                    return int(val)
                except ValueError:
                    return 0
            return int(val or 0)

        def _float(key):
            val = raw.get(key, 0)
            if isinstance(val, str):
                val = val.replace("%", "").strip()
                if not val:
                    return 0.0
                if "/" in val:
                    try:
                        parts = val.split("/")
                        if len(parts) == 2:
                            try:
                                num = float(parts[0])
                                den = float(parts[1])
                                return num / den if den != 0 else num
                            except ValueError:
                                return 0.0
                        return float(parts[0])
                    except ValueError:
                        return 0.0
                try:
                    return float(val)
                except ValueError:
                    return 0.0
            return float(val or 0)

        return {
            "possession_pct": _float("ballPossession"),
            "total_shots": _int("totalShotsOnGoal")
            + _int("totalShotsOffGoal")
            + _int("blockedScoringAttempt"),
            "shots_on_target": _int("totalShotsOnGoal"),
            "corners": _int("cornerKicks"),
            "fouls": _int("fouls"),
            "offsides_team": _int("totalOffside"),
            "expected_goals": _float("expectedGoals"),
            "big_chances": _int("bigChance"),
            "big_chances_missed": _int("bigChanceMissed"),
            "accurate_passes": _int("accuratePass"),
            "total_passes": _int("totalPass"),
            "tackles": _int("wonTackle"),
            "interceptions": _int("interceptionWon"),
            "saves_team": _int("saves"),
            "final_third_entries": _int("finalThirdEntries"),
            "final_third_phase_stats": _int("finalThirdPhaseStatistic"),
        }

    return [_parse_team(home_stats), _parse_team(away_stats)]


def fetch_standings(tournament_id: int, season_id: int) -> list[dict]:
    try:
        data = _api_get(
            f"unique-tournament/{tournament_id}/season/{season_id}/standings/total"
        )
        time.sleep(REQUEST_DELAY)
    except Exception as e:
        log.warning(f"Failed to fetch standings for tournament {tournament_id}: {e}")
        return []

    standings = []
    for table in data.get("standings", []):
        for row in table.get("rows", []):
            team = row.get("team", {})
            form_matches = row.get("descriptions", [])
            form_str = "".join(
                {"W": "W", "D": "D", "L": "L"}.get(
                    f.get("value") if isinstance(f, dict) else f, "?"
                )
                for f in form_matches
            )

            standings.append(
                {
                    "team_sofascore_id": team.get("id"),
                    "team_name": team.get("name", ""),
                    "position": row.get("position", 0),
                    "points": row.get("points", 0),
                    "played": row.get("matches", 0),
                    "won": row.get("wins", 0),
                    "drawn": row.get("draws", 0),
                    "lost": row.get("losses", 0),
                    "goals_for": row.get("scoresFor", 0),
                    "goals_against": row.get("scoresAgainst", 0),
                    "goal_difference": row.get("scoresFor", 0)
                    - row.get("scoresAgainst", 0),
                    "form": form_str,
                }
            )

    log.info(f"Fetched standings: {len(standings)} teams")
    return standings


def _parse_odds_value(decimal_val, fractional_val) -> float | None:
    if decimal_val is not None:
        try:
            return float(decimal_val)
        except (ValueError, TypeError):
            pass
    if fractional_val is not None:
        try:
            s = str(fractional_val).strip()
            if "/" in s:
                num, den = s.split("/", 1)
                den_f = float(den)
                return float(num) / den_f + 1.0 if den_f != 0 else None
            return float(s) + 1.0
        except (ValueError, TypeError):
            pass
    return None


def fetch_match_odds(event_id: int) -> dict | None:
    try:
        data = _api_get(f"event/{event_id}/odds/1/all")
        time.sleep(REQUEST_DELAY)
    except Exception as e:
        log.debug(f"No odds for event {event_id}: {e}")
        return None

    markets = data.get("markets", [])
    if not markets:
        return None

    choices = markets[0].get("choices", [])
    odds = {}
    for choice in choices:
        name = choice.get("name", "")
        decimal_val = _parse_odds_value(
            choice.get("decimalValue"), choice.get("fractionalValue")
        )
        if name == "1":
            odds["home_win"] = decimal_val
        elif name == "X":
            odds["draw"] = decimal_val
        elif name == "2":
            odds["away_win"] = decimal_val

    return odds if odds else None


def fetch_shotmap(event_id: int) -> list[dict]:
    try:
        data = _api_get(f"event/{event_id}/shotmap")
        time.sleep(REQUEST_DELAY)
    except Exception as e:
        log.debug(f"No shotmap for event {event_id}: {e}")
        return []

    shots = []
    for shot in data.get("shotmap", []):
        player = shot.get("player", {})
        coords = shot.get("playerCoordinates", {})

        x = 1.0 - (coords.get("x", 0) or 0) / 100.0
        y = (coords.get("y", 0) or 0) / 100.0

        goal_mouth = shot.get("goalMouthCoordinates", {})
        gm_y = (goal_mouth.get("y", 0) or 0) / 100.0 if goal_mouth else None
        gm_z = (goal_mouth.get("z", 0) or 0) / 100.0 if goal_mouth else None

        shot_type = shot.get("shotType", "")
        result_map = {
            "goal": "Goal",
            "save": "SavedShot",
            "miss": "MissedShots",
            "block": "BlockedShot",
            "post": "ShotOnPost",
        }
        result = result_map.get(shot_type, shot_type)

        shots.append(
            {
                "sofascore_id": shot.get("id"),
                "player_sofascore_id": player.get("id"),
                "player_name": player.get("name", ""),
                "minute": shot.get("time"),
                "x": round(x, 4),
                "y": round(y, 4),
                "xg": shot.get("xg", 0.0) or 0.0,
                "result": result,
                "situation": shot.get("situation", ""),
                "body_part": shot.get("bodyPart", ""),
                "goal_mouth_y": round(gm_y, 4) if gm_y is not None else None,
                "goal_mouth_z": round(gm_z, 4) if gm_z is not None else None,
            }
        )

    log.info(f"Fetched {len(shots)} shots for event {event_id}")
    return shots


def fetch_match_graph(event_id: int) -> list[dict]:
    """Momentum graph points: [{minute, value}, ...]. Positive=home, negative=away."""
    try:
        data = _api_get(f"event/{event_id}/graph")
        time.sleep(REQUEST_DELAY)
    except Exception as e:
        log.debug(f"No graph for event {event_id}: {e}")
        return []
    return data.get("graphPoints", [])


def fetch_best_players(event_id: int) -> dict:
    """Best players for a match: {best_home, best_away, player_of_the_match}."""
    try:
        data = _api_get(f"event/{event_id}/best-players/summary")
        time.sleep(REQUEST_DELAY)
    except Exception as e:
        log.debug(f"No best-players for event {event_id}: {e}")
        return {}
    return {
        "best_home": data.get("bestHomeTeamPlayers", []),
        "best_away": data.get("bestAwayTeamPlayers", []),
        "player_of_the_match": data.get("playerOfTheMatch"),
    }


def fetch_head_to_head(event_id: int) -> dict:
    """H2H duel record for a match: {team_duel, manager_duel}."""
    try:
        data = _api_get(f"event/{event_id}/h2h")
        time.sleep(REQUEST_DELAY)
    except Exception as e:
        log.debug(f"No h2h for event {event_id}: {e}")
        return {}
    return {
        "team_duel": data.get("teamDuel", {}),
        "manager_duel": data.get("managerDuel", {}),
    }


def fetch_pregame_form(event_id: int) -> dict:
    """Pregame form and label for both teams."""
    try:
        data = _api_get(f"event/{event_id}/pregame-form")
        time.sleep(REQUEST_DELAY)
    except Exception as e:
        log.debug(f"No pregame-form for event {event_id}: {e}")
        return {}
    return {
        "home": data.get("homeTeam", {}),
        "away": data.get("awayTeam", {}),
        "label": data.get("label"),
    }


def fetch_managers(event_id: int) -> dict:
    """Home/away managers for a match."""
    try:
        data = _api_get(f"event/{event_id}/managers")
        time.sleep(REQUEST_DELAY)
    except Exception as e:
        log.debug(f"No managers for event {event_id}: {e}")
        return {}
    return {
        "home": data.get("homeManager", {}),
        "away": data.get("awayManager", {}),
    }


def fetch_average_positions(event_id: int) -> dict:
    """Per-player average on-pitch positions (x/y percent)."""
    try:
        data = _api_get(f"event/{event_id}/average-positions")
        time.sleep(REQUEST_DELAY)
    except Exception as e:
        log.debug(f"No average-positions for event {event_id}: {e}")
        return {}
    return {
        "home": data.get("home", []),
        "away": data.get("away", []),
        "substitutions": data.get("substitutions", []),
    }


def fetch_full_match_statistics(event_id: int) -> dict:
    """
    Full team stats payload, grouped by period (ALL/1ST/2ND) and section
    (Match overview, Shots, Attack, Passes, Duels, Defending, Goalkeeping).

    Unlike fetch_match_statistics which flattens to per-team totals, this
    preserves the full nested structure for downstream storage.
    """
    try:
        data = _api_get(f"event/{event_id}/statistics")
        time.sleep(REQUEST_DELAY)
    except Exception as e:
        log.debug(f"No full statistics for event {event_id}: {e}")
        return {}
    return data


def fetch_team_streaks(event_id: int) -> dict:
    """General + head-to-head streak summary for a match."""
    try:
        data = _api_get(f"event/{event_id}/team-streaks")
        time.sleep(REQUEST_DELAY)
    except Exception as e:
        log.debug(f"No team-streaks for event {event_id}: {e}")
        return {}
    return data


def fetch_featured_players(event_id: int) -> dict:
    """Featured (highlighted) players for both sides in a match."""
    try:
        data = _api_get(f"event/{event_id}/featured-players")
        time.sleep(REQUEST_DELAY)
    except Exception as e:
        log.debug(f"No featured-players for event {event_id}: {e}")
        return {}
    return {"home": data.get("home"), "away": data.get("away")}


def fetch_match_highlights(event_id: int) -> list[dict]:
    """Video highlight entries for a match."""
    try:
        data = _api_get(f"event/{event_id}/highlights")
        time.sleep(REQUEST_DELAY)
    except Exception as e:
        log.debug(f"No highlights for event {event_id}: {e}")
        return []
    return data.get("highlights", [])


def fetch_match_odds_all(event_id: int) -> list[dict]:
    """
    Full odds payload across all markets (not just 1X2).

    Returns list of markets, each with name, choices[{name, decimalValue,
    fractionalValue, sourceId, winning}], marketId, etc.
    """
    try:
        data = _api_get(f"event/{event_id}/odds/1/all")
        time.sleep(REQUEST_DELAY)
    except Exception as e:
        log.debug(f"No all-odds for event {event_id}: {e}")
        return []
    return data.get("markets", [])


def fetch_match_odds_featured(event_id: int) -> dict:
    """Featured odds subset (displayed on the match page)."""
    try:
        data = _api_get(f"event/{event_id}/odds/1/featured")
        time.sleep(REQUEST_DELAY)
    except Exception as e:
        log.debug(f"No featured-odds for event {event_id}: {e}")
        return {}
    return data


def fetch_player_match_heatmap(event_id: int, player_id: int) -> list[dict]:
    """Per-match heatmap points for a player: [{x, y}, ...]."""
    try:
        data = _api_get(f"event/{event_id}/player/{player_id}/heatmap")
        time.sleep(REQUEST_DELAY)
    except Exception as e:
        log.debug(f"No heatmap for player {player_id} in event {event_id}: {e}")
        return []
    return data.get("heatmap", [])


def fetch_player_match_statistics(event_id: int, player_id: int) -> dict:
    """Per-match statistics for a single player (already partly used via lineups)."""
    try:
        data = _api_get(f"event/{event_id}/player/{player_id}/statistics")
        time.sleep(REQUEST_DELAY)
    except Exception as e:
        log.debug(f"No per-match stats for player {player_id} in event {event_id}: {e}")
        return {}
    return data


def fetch_player_season_heatmap(
    player_id: int, tournament_id: int, season_id: int
) -> dict:
    """
    Full-season heatmap for a player in a tournament/season.

    Returns {points, matches, events} — points are the aggregated heatmap,
    matches is a count, events lists contributing matches.
    """
    try:
        data = _api_get(
            f"player/{player_id}/unique-tournament/{tournament_id}/"
            f"season/{season_id}/heatmap/overall"
        )
        time.sleep(REQUEST_DELAY)
    except Exception as e:
        log.debug(f"No season heatmap for player {player_id}: {e}")
        return {}
    return data


def fetch_player_attribute_overview(player_id: int) -> dict:
    """
    Radar/attribute overview for a player (attacking, technical, tactical,
    defending, creativity). Also includes position-average comparison.
    """
    try:
        data = _api_get(f"player/{player_id}/attribute-overviews")
        time.sleep(REQUEST_DELAY)
    except Exception as e:
        log.debug(f"No attribute-overviews for player {player_id}: {e}")
        return {}
    return {
        "player": data.get("playerAttributeOverviews", []),
        "average": data.get("averageAttributeOverviews", []),
    }


def fetch_player_transfer_history(player_id: int) -> list[dict]:
    """Transfer history entries for a player."""
    try:
        data = _api_get(f"player/{player_id}/transfer-history")
        time.sleep(REQUEST_DELAY)
    except Exception as e:
        log.debug(f"No transfer-history for player {player_id}: {e}")
        return []
    return data.get("transferHistory", [])


def fetch_player_characteristics(player_id: int) -> dict:
    """Strengths, weaknesses, and playable positions for a player."""
    try:
        data = _api_get(f"player/{player_id}/characteristics")
        time.sleep(REQUEST_DELAY)
    except Exception as e:
        log.debug(f"No characteristics for player {player_id}: {e}")
        return {}
    return {
        "positive": data.get("positive", []),
        "negative": data.get("negative", []),
        "positions": data.get("positions", []),
    }


def fetch_player_ratings_history(player_id: int) -> dict:
    """
    Last-year summary for a player: per-match rating history + tournaments map.

    Keys: summary (list of {matchId, rating, ...}), uniqueTournamentsMap.
    """
    try:
        data = _api_get(f"player/{player_id}/last-year-summary")
        time.sleep(REQUEST_DELAY)
    except Exception as e:
        log.debug(f"No ratings history for player {player_id}: {e}")
        return {}
    return data


def fetch_player_national_team_stats(player_id: int) -> list[dict]:
    """National-team statistics for a player."""
    try:
        data = _api_get(f"player/{player_id}/national-team-statistics")
        time.sleep(REQUEST_DELAY)
    except Exception as e:
        log.debug(f"No national-team stats for player {player_id}: {e}")
        return []
    return data.get("statistics", [])


def fetch_player_season_statistics(
    player_id: int, tournament_id: int, season_id: int
) -> dict:
    """Aggregated season statistics for a player in one tournament/season."""
    try:
        data = _api_get(
            f"player/{player_id}/unique-tournament/{tournament_id}/"
            f"season/{season_id}/statistics/overall"
        )
        time.sleep(REQUEST_DELAY)
    except Exception as e:
        log.debug(f"No season stats for player {player_id}: {e}")
        return {}
    return data


_SEASON_STAT_FIELD_MAP = {
    # Appearance / rating meta
    "appearances": "appearances",
    "matches_started": "matchesStarted",
    "minutes_played": "minutesPlayed",
    "rating": "rating",
    "total_rating": "totalRating",
    "count_rating": "countRating",
    "totw_appearances": "totwAppearances",

    # Goals / shots
    "goals": "goals",
    "expected_goals": "expectedGoals",
    "penalty_goals": "penaltyGoals",
    "headed_goals": "headedGoals",
    "left_foot_goals": "leftFootGoals",
    "right_foot_goals": "rightFootGoals",
    "goals_from_inside_box": "goalsFromInsideTheBox",
    "goals_from_outside_box": "goalsFromOutsideTheBox",
    "shots_total": "totalShots",
    "shots_on_target": "shotsOnTarget",
    "shots_off_target": "shotsOffTarget",
    "shots_from_inside_box": "shotsFromInsideTheBox",
    "shots_from_outside_box": "shotsFromOutsideTheBox",
    "blocked_shots": "blockedShots",
    "hit_woodwork": "hitWoodwork",
    "goal_conversion_pct": "goalConversionPercentage",
    "scoring_frequency": "scoringFrequency",

    # Passing
    "accurate_passes": "accuratePasses",
    "total_passes": "totalPasses",
    "accurate_passes_pct": "accuratePassesPercentage",
    "inaccurate_passes": "inaccuratePasses",
    "accurate_opposition_half_passes": "accurateOppositionHalfPasses",
    "total_opposition_half_passes": "totalOppositionHalfPasses",
    "accurate_own_half_passes": "accurateOwnHalfPasses",
    "total_own_half_passes": "totalOwnHalfPasses",
    "accurate_final_third_passes": "accurateFinalThirdPasses",
    "accurate_chipped_passes": "accurateChippedPasses",
    "total_chipped_passes": "totalChippedPasses",
    "accurate_long_balls": "accurateLongBalls",
    "total_long_balls": "totalLongBalls",
    "accurate_long_balls_pct": "accurateLongBallsPercentage",
    "accurate_crosses": "accurateCrosses",
    "total_cross": "totalCross",
    "accurate_crosses_pct": "accurateCrossesPercentage",
    "key_passes": "keyPasses",
    "pass_to_assist": "passToAssist",
    "total_attempt_assist": "totalAttemptAssist",

    # Creation
    "assists": "assists",
    "expected_assists": "expectedAssists",
    "goals_assists_sum": "goalsAssistsSum",
    "big_chances_created": "bigChancesCreated",
    "big_chances_missed": "bigChancesMissed",

    # Dribbling / carrying
    "successful_dribbles": "successfulDribbles",
    "successful_dribbles_pct": "successfulDribblesPercentage",
    "total_contest": "totalContest",
    "dispossessed": "dispossessed",
    "possession_lost": "possessionLost",
    "possession_won_att_third": "possessionWonAttThird",
    "dribbled_past": "dribbledPast",

    # Duels / defending
    "aerial_duels_won": "aerialDuelsWon",
    "aerial_duels_won_pct": "aerialDuelsWonPercentage",
    "aerial_lost": "aerialLost",
    "ground_duels_won": "groundDuelsWon",
    "ground_duels_won_pct": "groundDuelsWonPercentage",
    "total_duels_won": "totalDuelsWon",
    "total_duels_won_pct": "totalDuelsWonPercentage",
    "duel_lost": "duelLost",
    "tackles": "tackles",
    "tackles_won": "tacklesWon",
    "tackles_won_pct": "tacklesWonPercentage",
    "interceptions": "interceptions",
    "clearances": "clearances",
    "outfielder_blocks": "outfielderBlocks",
    "ball_recovery": "ballRecovery",
    "error_lead_to_goal": "errorLeadToGoal",
    "error_lead_to_shot": "errorLeadToShot",

    # Discipline / misc
    "fouls": "fouls",
    "was_fouled": "wasFouled",
    "offsides": "offsides",
    "yellow_cards": "yellowCards",
    "yellow_red_cards": "yellowRedCards",
    "red_cards": "redCards",
    "own_goals": "ownGoals",
    "penalty_won": "penaltyWon",
    "penalty_conceded": "penaltyConceded",
    "touches": "touches",
}


def fetch_player_season_stats_flat(
    player_id: int, tournament_id: int, season_id: int
) -> dict | None:
    """
    Fetch player season stats and flatten to DB column names.

    Returns None if the API returns no stats (player did not appear in
    that tournament/season), else a dict keyed by player_season_sofascore
    column names. Missing fields are returned as None.
    """
    data = fetch_player_season_statistics(player_id, tournament_id, season_id)
    stats = data.get("statistics") if data else None
    if not stats:
        return None

    out: dict = {}
    for db_col, api_key in _SEASON_STAT_FIELD_MAP.items():
        out[db_col] = stats.get(api_key)
    return out


def fetch_player_recent_events(player_id: int, page: int = 0) -> dict:
    """Most recent events a player has featured in (paginated)."""
    try:
        data = _api_get(f"player/{player_id}/events/last/{page}")
        time.sleep(REQUEST_DELAY)
    except Exception as e:
        log.debug(f"No recent events for player {player_id}: {e}")
        return {}
    return data


def fetch_tournament_top_players(tournament_id: int, season_id: int) -> dict:
    """
    Top-players leaderboards for a tournament season — ranked by all
    Sofascore-tracked stats (rating, goals, assists, etc.).
    """
    try:
        data = _api_get(
            f"unique-tournament/{tournament_id}/season/{season_id}/"
            f"top-players/overall"
        )
        time.sleep(REQUEST_DELAY)
    except Exception as e:
        log.debug(f"No top-players for tournament {tournament_id}: {e}")
        return {}
    return data.get("topPlayers", {})


def fetch_team_transfers(team_id: int) -> dict:
    """Transfers in/out for a team."""
    try:
        data = _api_get(f"team/{team_id}/transfers")
        time.sleep(REQUEST_DELAY)
    except Exception as e:
        log.debug(f"No transfers for team {team_id}: {e}")
        return {}
    return {
        "in": data.get("transfersIn", []),
        "out": data.get("transfersOut", []),
    }


def fetch_team_squad(team_id: int) -> dict:
    """Current + foreign + national-team players and support staff for a team."""
    try:
        data = _api_get(f"team/{team_id}/players")
        time.sleep(REQUEST_DELAY)
    except Exception as e:
        log.debug(f"No squad for team {team_id}: {e}")
        return {}
    return data


def fetch_team_near_events(team_id: int) -> dict:
    """Previous and next event for a team."""
    try:
        data = _api_get(f"team/{team_id}/near-events")
        time.sleep(REQUEST_DELAY)
    except Exception as e:
        log.debug(f"No near-events for team {team_id}: {e}")
        return {}
    return data


def fetch_scheduled_events(date_str: str) -> list[dict]:
    """
    All scheduled football events for a given date (YYYY-MM-DD).
    Large payload — use for fixture discovery/backfill.
    """
    try:
        data = _api_get(f"sport/football/scheduled-events/{date_str}")
        time.sleep(REQUEST_DELAY)
    except Exception as e:
        log.warning(f"Failed to fetch scheduled events for {date_str}: {e}")
        raise
    return data.get("events", [])


def clear_player_cache():
    """Clear the player profile cache. Call between different scrape sessions."""
    global _player_cache
    _player_cache = {}


def clear_season_cache():
    """Clear the season lookup cache. Call if seasons change."""
    global _season_cache
    _season_cache = {}
