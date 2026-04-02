"""
Sofascore scraper.

Fetches match lists and per-player match stats from Sofascore's API.
Uses curl_cffi with Chrome impersonation to bypass bot detection.
"""

import time
from datetime import datetime
from curl_cffi import requests as cffi_requests
from tenacity import retry, stop_after_attempt, wait_exponential

from pipeline.logger import get_logger

log = get_logger("sofascore")

BASE_URL = "https://www.sofascore.com/api/v1"
REQUEST_DELAY = 2  # seconds between API calls

# Sofascore unique-tournament IDs
TOURNAMENT_IDS = {
    47: 17,  # Premier League (fotmob_id → sofascore tournament_id)
    48: 18,  # Championship
    87: 8,  # La Liga
    53: 34,  # Ligue 1
    55: 23,  # Serie A
    54: 35,  # Bundesliga
}


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=5, max=30))
def _api_get(path: str) -> dict:
    """Fetch a Sofascore API endpoint and return JSON."""
    url = f"{BASE_URL}/{path}"
    resp = cffi_requests.get(url, impersonate="chrome", timeout=30)
    resp.raise_for_status()
    return resp.json()


def get_current_season_id(tournament_id: int) -> int | None:
    """Get the current (latest) season ID for a tournament."""
    data = _api_get(f"unique-tournament/{tournament_id}/seasons")
    seasons = data.get("seasons", [])
    if not seasons:
        return None
    return seasons[0]["id"]


def fetch_league_matches(fotmob_league_id: int, season: str) -> list[dict]:
    """
    Fetch all completed matches for a league season from Sofascore.

    Iterates through all rounds, collecting finished matches.

    Args:
        fotmob_league_id: FotMob league ID (mapped internally to Sofascore tournament ID)
        season: Season string like "2025/2026" (used for logging only)

    Returns:
        List of match dicts compatible with the existing pipeline.
    """
    tournament_id = TOURNAMENT_IDS.get(fotmob_league_id)
    if not tournament_id:
        log.error(
            f"No Sofascore tournament mapping for FotMob league {fotmob_league_id}"
        )
        return []

    season_id = get_current_season_id(tournament_id)
    if not season_id:
        log.error(f"Could not find current season for tournament {tournament_id}")
        return []

    log.info(f"Fetching matches for tournament {tournament_id}, season {season_id}")

    matches = []
    for round_num in range(1, 50):  # max 46 rounds (Championship)
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

            # Convert timestamp to date string
            ts = event.get("startTimestamp", 0)
            date_str = datetime.utcfromtimestamp(ts).strftime("%Y-%m-%d") if ts else ""

            matches.append(
                {
                    "sofascore_id": event["id"],
                    "fotmob_id": None,  # We don't have FotMob IDs anymore
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


def fetch_match_details(event_id: int) -> dict:
    """
    Fetch detailed match data (lineups + incidents) from Sofascore.

    Unlike FotMob, Sofascore uses unique event IDs — no slug collision issues.

    Args:
        event_id: Sofascore event ID

    Returns:
        Dict with 'lineups' and 'incidents' data, or empty dict on failure.
    """
    log.info(f"Fetching match details for event {event_id}")

    try:
        lineups = _api_get(f"event/{event_id}/lineups")
        time.sleep(REQUEST_DELAY)
    except Exception as e:
        log.warning(f"Failed to fetch lineups for event {event_id}: {e}")
        return {}

    try:
        incidents_data = _api_get(f"event/{event_id}/incidents")
        time.sleep(REQUEST_DELAY)
    except Exception as e:
        log.warning(f"Failed to fetch incidents for event {event_id}: {e}")
        incidents_data = {"incidents": []}

    return {
        "lineups": lineups,
        "incidents": incidents_data.get("incidents", []),
    }


def _infer_positions_from_formation(formation: str, players: list[dict]) -> list[str]:
    """
    Infer granular positions from formation string and player order.

    Sofascore lists starters in order: GK, then defenders R→L,
    then midfielders R→L, then forwards R→L.
    (Right-to-left from the goalkeeper's perspective looking outward)

    E.g. formation "4-2-3-1" with 11 starters:
      [GK, RB, CB, CB, LB, CM, CM, RW, CAM, LW, ST]
    """
    if not formation:
        return []

    lines = [int(x) for x in formation.split("-")]
    positions = ["GK"]  # Always starts with GK

    # Defenders (ordered R→L)
    num_def = lines[0] if lines else 4
    if num_def == 3:
        positions.extend(["CB", "CB", "CB"])
    elif num_def == 4:
        positions.extend(["RB", "CB", "CB", "LB"])
    elif num_def == 5:
        positions.extend(["RWB", "CB", "CB", "CB", "LWB"])
    else:
        positions.extend(["CB"] * num_def)

    # Remaining lines (midfield + attack)
    remaining_lines = lines[1:]

    for i, num_players in enumerate(remaining_lines):
        is_last_line = i == len(remaining_lines) - 1

        if is_last_line:
            # Forward line
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
            # Midfield line(s)
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


def _get_sub_position(player: dict, formation_positions: dict[int, str]) -> str:
    """Determine a substitute's position based on who they replaced."""
    # This will be populated by the caller from incidents
    basic_pos = player.get("position", "M")
    fallback = {"G": "GK", "D": "CB", "M": "CM", "F": "ST"}.get(basic_pos, "CM")
    return fallback


# Sort order for basic Sofascore position codes (G/D/M/F)
_POS_LINE_ORDER = {"G": 0, "D": 1, "M": 2, "F": 3}

# Maps Sofascore positionsDetailed codes to our position codes.
# These come from the /player/{id} profile endpoint.
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
    "CF": "CF",
    "ST": "ST",
    "SS": "ST",
    "G": "GK",
}


def _basic_pos(player: dict) -> str:
    """Return the G/D/M/F position code for a lineup player dict."""
    # Sofascore exposes it on the outer dict and/or the nested player object
    for val in (player.get("position"), (player.get("player") or {}).get("position")):
        if val and str(val) in _POS_LINE_ORDER:
            return str(val)
    return "M"  # safe fallback


def extract_player_stats(detail: dict, match_info: dict = None) -> list[dict]:
    """
    Extract per-player stats from Sofascore lineups + incidents.

    Args:
        detail: Dict with 'lineups' and 'incidents' keys
        match_info: Optional match dict for context

    Returns:
        List of player stat dicts compatible with the existing pipeline schema.
    """
    lineups = detail.get("lineups", {})
    incidents = detail.get("incidents", [])

    # Build substitution map: player_out_id → player_in_id (and reverse)
    sub_map_out_to_in = {}  # who replaced whom
    sub_map_in_to_out = {}  # who was replaced by whom
    for inc in incidents:
        if inc.get("incidentType") == "substitution":
            player_in = inc.get("playerIn", {})
            player_out = inc.get("playerOut", {})
            if player_in.get("id") and player_out.get("id"):
                sub_map_out_to_in[player_out["id"]] = player_in["id"]
                sub_map_in_to_out[player_in["id"]] = player_out["id"]

    # Build card map: player_id → {yellow_cards, red_cards}
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

        # Separate starters and subs.
        # Sort starters by position line (G→D→M→F) then shirt number.
        # Note: Sofascore lineups only provide basic position (G/D/M/F), not
        # detailed position (RB/CB/LB etc). We infer detailed positions from
        # the formation string. Player position_played is supplemented by
        # their canonical position from the players table.
        starters = sorted(
            [p for p in team_players if not p.get("substitute", False)],
            key=lambda p: (
                _POS_LINE_ORDER.get(_basic_pos(p), 2),
                p.get("shirtNumber", 99),
            ),
        )
        subs = [p for p in team_players if p.get("substitute", False)]

        # Infer positions from formation string.
        # Sofascore doesn't provide detailed position in lineups, only G/D/M/F.
        starter_pos_map: dict[int, str] = {}
        formation_positions = _infer_positions_from_formation(formation, starters)
        for idx, player in enumerate(starters):
            pid = player.get("player", {}).get("id")
            if pid and idx < len(formation_positions):
                starter_pos_map[pid] = formation_positions[idx]

        # Process all players (starters + subs)
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

            # Determine position
            if not is_sub and pid in starter_pos_map:
                position = starter_pos_map[pid]
            elif is_sub:
                # Sub inherits position from the player they replaced
                replaced_pid = sub_map_in_to_out.get(pid)
                if replaced_pid and replaced_pid in starter_pos_map:
                    position = starter_pos_map[replaced_pid]
                else:
                    # Fallback to basic position
                    position = {"G": "GK", "D": "CB", "M": "CM", "F": "ST"}.get(
                        _basic_pos(player), "CM"
                    )
            else:
                position = {"G": "GK", "D": "CB", "M": "CM", "F": "ST"}.get(
                    _basic_pos(player), "CM"
                )

            # Extract stats — map Sofascore keys to our schema
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
                # Expanded passing stats
                "total_cross": stats.get("totalCross", 0) or 0,
                "accurate_cross": stats.get("accurateCross", 0) or 0,
                "total_long_balls": stats.get("totalLongBalls", 0) or 0,
                "accurate_long_balls": stats.get("accurateLongBalls", 0) or 0,
                "big_chance_created": stats.get("bigChanceCreated", 0) or 0,
                # Expanded shooting stats
                "big_chance_missed": stats.get("bigChanceMissed", 0) or 0,
                "hit_woodwork": stats.get("hitWoodwork", 0) or 0,
                "blocked_scoring_attempt": stats.get("blockedScoringAttempt", 0) or 0,
                # Defensive stats
                "clearances": stats.get("totalClearance", 0) or 0,
                "head_clearance": stats.get("headClearance", 0) or 0,
                "outfielder_block": stats.get("outfielderBlock", 0) or 0,
                "ball_recovery": stats.get("ballRecovery", 0) or 0,
                # Errors
                "error_lead_to_goal": stats.get("errorLeadToGoal", 0) or 0,
                "error_lead_to_shot": stats.get("errorLeadToShot", 0) or 0,
                # Possession
                "possession_lost_ctrl": stats.get("possessionLostCtrl", 0) or 0,
                "total_contest": stats.get("totalContest", 0) or 0,
                # Other
                "penalty_won": stats.get("penaltyWon", 0) or 0,
                "penalty_conceded": stats.get("penaltyConceded", 0) or 0,
                "own_goals": stats.get("ownGoals", 0) or 0,
            }

            # GK-specific stats (only present for goalkeepers)
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


def fetch_player_profile(player_id: int) -> dict | None:
    """
    Fetch player profile data from Sofascore.

    Returns dict with bio fields, or None on failure.
    """
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
        for pos_code in positions_detailed:
            mapped = _POSITIONS_DETAILED_MAP.get(pos_code)
            if mapped:
                position = mapped
                break

    return {
        "date_of_birth": dob,
        "height_cm": player.get("height"),
        "preferred_foot": player.get("preferredFoot"),
        "shirt_number": player.get("jerseyNumber"),
        "nationality": player.get("country", {}).get("name"),
        "position": position,
    }


def fetch_match_statistics(event_id: int) -> list[dict]:
    """
    Fetch team-level match statistics from Sofascore.

    Returns list of two dicts (home, away) with team stats, or empty list on failure.
    """
    try:
        data = _api_get(f"event/{event_id}/statistics")
        time.sleep(REQUEST_DELAY)
    except Exception as e:
        log.warning(f"Failed to fetch statistics for event {event_id}: {e}")
        return []

    # Sofascore returns statistics grouped by period; use "ALL" (full match)
    periods = data.get("statistics", [])
    all_period = None
    for period in periods:
        if period.get("period") == "ALL":
            all_period = period
            break

    if not all_period:
        log.warning(f"No ALL period stats for event {event_id}")
        return []

    # Parse stat groups into home/away dicts
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
                # Handle fraction strings like "7/5" by taking first number
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
                # Handle fraction strings like "67/100" or "7/5"
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
                # Try to parse as regular float
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
    """
    Fetch league standings from Sofascore.

    Returns list of team standing dicts, or empty list on failure.
    """
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
            # Build form string from recent matches
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
    """Return a decimal float from Sofascore odds fields.

    Prefer decimalValue (already a float). Fall back to parsing fractionalValue
    ('13/10' → 1.3) if decimalValue is absent.
    """
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
    """
    Fetch 1X2 betting odds for a match from Sofascore.

    Returns dict with home_win/draw/away_win, or None on failure.
    """
    try:
        data = _api_get(f"event/{event_id}/odds/1/all")
        time.sleep(REQUEST_DELAY)
    except Exception as e:
        log.debug(f"No odds for event {event_id}: {e}")
        return None

    markets = data.get("markets", [])
    if not markets:
        return None

    # Use the first bookmaker's odds
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

    if not odds:
        return None
    return odds


def fetch_shotmap(event_id: int) -> list[dict]:
    """
    Fetch shot map data for a match from Sofascore.

    Returns list of shot dicts with coordinates and metadata, or empty list on failure.
    """
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

        # Sofascore x=0 is the attacking goal; flip so x=1 means near goal (Understat convention)
        x = 1.0 - (coords.get("x", 0) or 0) / 100.0
        y = (coords.get("y", 0) or 0) / 100.0

        goal_mouth = shot.get("goalMouthCoordinates", {})
        gm_y = (goal_mouth.get("y", 0) or 0) / 100.0 if goal_mouth else None
        gm_z = (goal_mouth.get("z", 0) or 0) / 100.0 if goal_mouth else None

        # Map Sofascore shot type to result string
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
