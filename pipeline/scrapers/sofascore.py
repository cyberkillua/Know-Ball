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
from concurrent.futures import ThreadPoolExecutor
from curl_cffi.requests import AsyncSession, Session
from datetime import datetime
from tenacity import retry, stop_after_attempt, wait_exponential

from pipeline.logger import get_logger

log = get_logger("sofascore")

BASE_URL = "https://www.sofascore.com/api/v1"
REQUEST_DELAY = 0.5

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
    "CB": 1, "LB": 1, "RB": 1, "LWB": 1, "RWB": 1,
    "CDM": 2, "CM": 2, "LM": 2, "RM": 2,
    "CAM": 3, "LW": 3, "RW": 3,
    "CF": 4, "ST": 4,
}

# Positionally adjacent positions (one step away tactically)
_POS_ADJACENCY: dict[str, frozenset] = {
    "GK":  frozenset(),
    "CB":  frozenset({"CDM", "LB", "RB"}),
    "LB":  frozenset({"CB", "LM", "LWB"}),
    "RB":  frozenset({"CB", "RM", "RWB"}),
    "LWB": frozenset({"LB", "LM"}),
    "RWB": frozenset({"RB", "RM"}),
    "CDM": frozenset({"CM", "CB"}),
    "CM":  frozenset({"CDM", "CAM", "LM", "RM"}),
    "LM":  frozenset({"LW", "CM", "LB"}),
    "RM":  frozenset({"RW", "CM", "RB"}),
    "CAM": frozenset({"CF", "CM", "LW", "RW"}),
    "LW":  frozenset({"ST", "LM", "CAM"}),
    "RW":  frozenset({"ST", "RM", "CAM"}),
    "CF":  frozenset({"ST", "CAM"}),
    "ST":  frozenset({"CF", "LW", "RW"}),
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
        self._lock = asyncio.Lock() if asyncio.get_event_loop().is_running() else None

    async def acquire_async(self):
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


_rate_limiter = RateLimiter(rate=2.0, burst=10)


async def _api_get_async(path: str, session: AsyncSession) -> dict:
    url = f"{BASE_URL}/{path}"
    await _rate_limiter.acquire_async()
    resp = await session.get(url, impersonate="chrome", timeout=30)
    resp.raise_for_status()
    return resp.json()


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=5, max=30))
def _api_get(path: str) -> dict:
    url = f"{BASE_URL}/{path}"
    _rate_limiter.acquire_sync()
    resp = Session().get(url, impersonate="chrome", timeout=30)
    resp.raise_for_status()
    return resp.json()


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
    for round_num in range(1, 50):
        try:
            data = _api_get(
                f"unique-tournament/{tournament_id}/season/{season_id}/events/round/{round_num}"
            )
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

        best_i = min(range(len(available)), key=lambda i: _position_cost(profile_pos, available[i]))
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
                "team_id": player.get("teamId"),
                "position_played": position,
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
                "successful_dribbles": stats.get("wonContest", 0) or 0,
                "failed_dribbles": stats.get("dispossessed", 0) or 0,
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

    profile = {
        "date_of_birth": dob,
        "height_cm": player.get("height"),
        "preferred_foot": player.get("preferredFoot"),
        "shirt_number": player.get("jerseyNumber"),
        "nationality": player.get("country", {}).get("name"),
        "position": position,
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

                    profiles[pid] = {
                        "date_of_birth": dob,
                        "height_cm": player.get("height"),
                        "preferred_foot": player.get("preferredFoot"),
                        "shirt_number": player.get("jerseyNumber"),
                        "nationality": player.get("country", {}).get("name"),
                        "position": position,
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
                {"W": "W", "D": "D", "L": "L"}.get(f, "?") for f in form_matches
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


def clear_player_cache():
    """Clear the player profile cache. Call between different scrape sessions."""
    global _player_cache
    _player_cache = {}


def clear_season_cache():
    """Clear the season lookup cache. Call if seasons change."""
    global _season_cache
    _season_cache = {}
