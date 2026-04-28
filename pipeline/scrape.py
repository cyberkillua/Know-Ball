"""
Main scraping entrypoint - Optimized version.

Fetches new matches and player stats from Sofascore,
then stores them in Postgres.

Optimizations:
- Player profile caching to avoid duplicate fetches
- Batch player profile fetching
- Skip profile fetch for existing complete players
- Deferred profile updates
"""

from datetime import datetime, timedelta, timezone

from pipeline.db import DB
from pipeline.leagues import CURRENT_SEASON, FOTMOB_ID_BY_TOURNAMENT_ID, LEAGUES
from pipeline.logger import get_logger
from pipeline.scrapers.sofascore import (
    fetch_league_matches,
    fetch_match_details,
    extract_player_stats,
    fetch_player_profile,
    get_position_from_lineup,
    fetch_match_statistics,
    fetch_standings,
    fetch_match_odds,
    fetch_shotmap,
    fetch_scheduled_events,
    get_season_id_by_name,
    list_available_seasons,
    clear_player_cache,
)
from pipeline.store import (
    get_existing_match_ids,
    get_league_id,
    needs_profile_fetch,
    upsert_player,
    upsert_team,
)
from pipeline.understat_sync import (
    backfill_understat_match_ids,
    update_understat_stats,
)

log = get_logger("scrape")

def _fill_player_profile(
    db: DB, player_db_id: int, sofascore_id: int, match_detail: dict | None = None
):
    """
    Fetch and store player profile data from Sofascore.

    Args:
        db: Database connection
        player_db_id: Our database player ID
        sofascore_id: Sofascore player ID
        match_detail: Match detail dict for lineup fallback (optional)
    """
    profile = fetch_player_profile(sofascore_id)

    if not profile:
        if match_detail:
            position = get_position_from_lineup(sofascore_id, match_detail)
            if position:
                db.execute(
                    "UPDATE players SET position = %s WHERE id = %s",
                    (position, player_db_id),
                )
                log.debug(
                    f"Player {sofascore_id}: position from lineup fallback: {position}"
                )
        return

    position = profile.get("position")

    if not position and match_detail:
        position = get_position_from_lineup(sofascore_id, match_detail)
        if position:
            log.debug(
                f"Player {sofascore_id}: position from lineup fallback: {position}"
            )

    contract_ts = profile.get("contract_until")
    contract_dt = (
        datetime.utcfromtimestamp(contract_ts).strftime("%Y-%m-%d %H:%M:%S")
        if contract_ts
        else None
    )

    db.execute(
        """UPDATE players
           SET nationality = COALESCE(%s, nationality),
              date_of_birth = COALESCE(%s, date_of_birth),
              height_cm = COALESCE(%s, height_cm),
              preferred_foot = COALESCE(%s, preferred_foot),
              shirt_number = COALESCE(%s, shirt_number),
              position = COALESCE(%s, position),
              market_value = COALESCE(%s, market_value),
              market_value_currency = COALESCE(%s, market_value_currency),
              contract_until = COALESCE(%s, contract_until)
           WHERE id = %s""",
        (
            profile.get("nationality"),
            profile.get("date_of_birth"),
            profile.get("height_cm"),
            profile.get("preferred_foot"),
            profile.get("shirt_number"),
            position,
            profile.get("market_value"),
            profile.get("market_value_currency"),
            contract_dt,
            player_db_id,
        ),
    )


def scrape_league(
    db: DB,
    league_name: str,
    fotmob_league_id: int,
    understat_slug: str | None,
    season: str,
    existing_ids: set[int],
):
    league_id = get_league_id(db, fotmob_league_id)
    if not league_id:
        log.error(f"League not found in DB: {league_name}")
        return

    log.info(f"=== Scraping {league_name} ({season}) ===")

    try:
        _store_standings(db, fotmob_league_id, league_id, season)
    except Exception as e:
        log.warning(f"Skipping standings for {league_name} ({season}): {e}")

    matches = fetch_league_matches(fotmob_league_id, season)
    new_matches = [m for m in matches if m["sofascore_id"] not in existing_ids]
    log.info(f"{len(new_matches)} new matches to process")

    stats_ok = 0
    stats_skipped = 0

    for match in new_matches:
        try:
            got_stats = _process_match(db, match, league_id, season)
            if got_stats:
                stats_ok += 1
            else:
                stats_skipped += 1
        except Exception as e:
            log.error(f"Error processing match {match['sofascore_id']}: {e}")
            stats_skipped += 1
            continue

    log.info(
        f"=== {league_name} done: {stats_ok} with player stats, "
        f"{stats_skipped} without ==="
    )

    # Post-Sofascore: link understat match IDs and pull player stats from Understat.
    # Only fires when new match data was actually processed (avoids unnecessary requests).
    if understat_slug and stats_ok > 0:
        backfill_understat_match_ids(db, understat_slug, season, league_id)
        update_understat_stats(db, understat_slug, season)


def _event_tournament_id(event: dict) -> int | None:
    tournament = event.get("tournament") or {}
    unique_tournament = tournament.get("uniqueTournament") or {}
    return unique_tournament.get("id") or tournament.get("uniqueTournamentId")


def _match_from_event(event: dict) -> dict | None:
    status = event.get("status") or {}
    if status.get("type") != "finished":
        return None

    tournament_id = _event_tournament_id(event)
    if tournament_id not in FOTMOB_ID_BY_TOURNAMENT_ID:
        return None

    home = event.get("homeTeam") or {}
    away = event.get("awayTeam") or {}
    home_score = event.get("homeScore") or {}
    away_score = event.get("awayScore") or {}
    round_info = event.get("roundInfo") or {}
    start_ts = event.get("startTimestamp")
    date_str = (
        datetime.fromtimestamp(start_ts, tz=timezone.utc).strftime("%Y-%m-%d")
        if start_ts
        else ""
    )

    return {
        "sofascore_id": event["id"],
        "fotmob_id": None,
        "date": date_str,
        "matchday": round_info.get("round"),
        "home_team": home.get("name", ""),
        "home_team_id": home.get("id", 0),
        "away_team": away.get("name", ""),
        "away_team_id": away.get("id", 0),
        "home_score": home_score.get("current"),
        "away_score": away_score.get("current"),
        "fotmob_league_id": FOTMOB_ID_BY_TOURNAMENT_ID[tournament_id],
    }


def scrape_recent_matches(
    db: DB,
    season: str,
    days: int,
    existing_ids: set[int],
) -> None:
    today = datetime.now(timezone.utc).date()
    league_meta = {fotmob_id: (name, understat_slug) for name, fotmob_id, understat_slug in LEAGUES}
    matches_by_league: dict[int, list[dict]] = {}
    seen_ids = set(existing_ids)

    for offset in range(1, days + 1):
        date_str = (today - timedelta(days=offset)).isoformat()
        log.info(f"Fetching completed scheduled events for {date_str}")
        events = fetch_scheduled_events(date_str)
        for event in events:
            match = _match_from_event(event)
            if not match or match["sofascore_id"] in seen_ids:
                continue
            seen_ids.add(match["sofascore_id"])
            matches_by_league.setdefault(match["fotmob_league_id"], []).append(match)

    if not matches_by_league:
        log.info(f"No new completed matches found in the previous {days} day(s)")
        return

    for fotmob_id, matches in matches_by_league.items():
        league_id = get_league_id(db, fotmob_id)
        if not league_id:
            log.error(f"League not found in DB for FotMob id {fotmob_id}")
            continue

        league_name, understat_slug = league_meta[fotmob_id]
        log.info(f"=== Recent scrape: {league_name} ({len(matches)} matches) ===")

        stats_ok = 0
        stats_skipped = 0
        for match in sorted(matches, key=lambda m: (m["date"], m["sofascore_id"])):
            try:
                got_stats = _process_match(db, match, league_id, season)
                existing_ids.add(match["sofascore_id"])
                if got_stats:
                    stats_ok += 1
                else:
                    stats_skipped += 1
            except Exception as e:
                log.error(f"Error processing match {match['sofascore_id']}: {e}")
                stats_skipped += 1

        log.info(
            f"=== Recent {league_name} done: {stats_ok} with player stats, "
            f"{stats_skipped} without ==="
        )

        if understat_slug and stats_ok > 0:
            backfill_understat_match_ids(db, understat_slug, season, league_id)
            update_understat_stats(db, understat_slug, season)


def _store_standings(db: DB, fotmob_league_id: int, league_id: int, season: str):
    tournament_id = TOURNAMENT_IDS.get(fotmob_league_id)
    if not tournament_id:
        return

    season_id = get_season_id_by_name(tournament_id, season)
    if not season_id:
        log.error(f"Season '{season}' not found, cannot store standings")
        return

    log.info(f"Fetching standings for season {season_id} ({season})")

    standings = fetch_standings(tournament_id, season_id)
    for row in standings:
        team_row = db.query_one(
            "SELECT id FROM teams WHERE sofascore_id = %s",
            (row["team_sofascore_id"],),
        )
        if not team_row:
            team_row = db.insert_returning(
                "INSERT INTO teams (name, sofascore_id, league_id) VALUES (%s, %s, %s) RETURNING id",
                (row["team_name"], row["team_sofascore_id"], league_id),
            )

        db.execute(
            """INSERT INTO league_standings
               (league_id, season, team_id, position, points, played, won, drawn, lost,
                goals_for, goals_against, goal_difference, form, fetched_at)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
               ON CONFLICT (league_id, season, team_id)
               DO UPDATE SET position = EXCLUDED.position, points = EXCLUDED.points,
                            played = EXCLUDED.played, won = EXCLUDED.won,
                            drawn = EXCLUDED.drawn, lost = EXCLUDED.lost,
                            goals_for = EXCLUDED.goals_for,
                            goals_against = EXCLUDED.goals_against,
                            goal_difference = EXCLUDED.goal_difference,
                            form = EXCLUDED.form, fetched_at = NOW()""",
            (
                league_id,
                season,
                team_row["id"],
                row["position"],
                row["points"],
                row["played"],
                row["won"],
                row["drawn"],
                row["lost"],
                row["goals_for"],
                row["goals_against"],
                row["goal_difference"],
                row["form"],
            ),
        )

    log.info(f"Updated standings: {len(standings)} teams")


def _get_profile_map_from_detail(db: DB, detail: dict) -> dict[int, str]:
    """
    Return a sofascore_id → position map for every player in the lineup
    whose detailed position is already stored in the DB.

    Used to seed the formation-slot matching algorithm so that known players
    (e.g. a right-back whose profile says "RB") anchor the correct slot
    instead of being assigned by shirt-number order.
    """
    sofascore_ids = []
    for side in ("home", "away"):
        for p in detail.get("lineups", {}).get(side, {}).get("players", []):
            pid = p.get("player", {}).get("id")
            if pid:
                sofascore_ids.append(pid)

    if not sofascore_ids:
        return {}

    rows = db.query(
        """SELECT sofascore_id, position FROM players
           WHERE sofascore_id IN %s
             AND position IS NOT NULL
             AND position NOT IN ('G', 'D', 'M', 'F')""",
        (tuple(sofascore_ids),),
    )
    return {row["sofascore_id"]: row["position"] for row in rows}


def _process_match(db: DB, match: dict, league_id: int, season: str) -> bool:
    sofascore_id = match["sofascore_id"]
    log.info(
        f"Processing match {sofascore_id}: {match['home_team']} vs {match['away_team']}"
    )

    home_team_id = upsert_team(db, match["home_team"], match["home_team_id"], league_id)
    away_team_id = upsert_team(db, match["away_team"], match["away_team_id"], league_id)

    match_row = db.insert_returning(
        """INSERT INTO matches (league_id, season, matchday, date, home_team_id, away_team_id, home_score, away_score, sofascore_id)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
           ON CONFLICT (sofascore_id) DO UPDATE SET home_score = EXCLUDED.home_score, away_score = EXCLUDED.away_score
           RETURNING id""",
        (
            league_id,
            season,
            match.get("matchday"),
            match["date"],
            home_team_id,
            away_team_id,
            match["home_score"],
            match["away_score"],
            sofascore_id,
        ),
    )
    match_db_id = match_row["id"]

    detail = fetch_match_details(sofascore_id)
    if not detail:
        log.warning(
            f"No details for match {sofascore_id} "
            f"({match['home_team']} vs {match['away_team']}). "
            f"Match record stored without player stats."
        )
        return False

    profile_map = _get_profile_map_from_detail(db, detail)
    player_stats = extract_player_stats(detail, match, profile_map=profile_map)

    team_id_map = {
        match["home_team_id"]: home_team_id,
        match["away_team_id"]: away_team_id,
    }

    players_to_update = []

    for ps in player_stats:
        our_team_id = team_id_map.get(ps["team_id"], home_team_id)
        player_id = upsert_player(
            db,
            ps["name"],
            ps["sofascore_player_id"],
            our_team_id,
            match["date"],
        )

        if needs_profile_fetch(db, player_id):
            players_to_update.append((player_id, ps["sofascore_player_id"]))

        db.execute(
            """INSERT INTO match_player_stats
               (match_id, player_id, team_id, minutes_played,
                goals, shots_total, shots_on_target, shots_off_target, xg, xgot,
                assists, xa, key_passes, touches, passes_total, passes_completed,
                successful_dribbles, failed_dribbles, fouls_won,
                aerial_duels_won, aerial_duels_lost, ground_duels_won, ground_duels_lost,
                tackles_won, interceptions, offsides, fouls_committed,
                yellow_cards, red_cards, sofascore_rating,
                total_cross, accurate_cross, total_long_balls, accurate_long_balls,
                big_chance_created, big_chance_missed, hit_woodwork, blocked_scoring_attempt,
                clearances, head_clearance, outfielder_block, ball_recovery,
                error_lead_to_goal, error_lead_to_shot,
                possession_lost_ctrl, total_contest,
                penalty_won, penalty_conceded, own_goals,
                penalty_goals, np_xg, np_shots,
                accurate_own_half_passes, total_own_half_passes,
                accurate_opposition_half_passes, total_opposition_half_passes,
                pass_value_normalized,
                total_ball_carries_distance, total_progressive_ball_carries_distance)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
               ON CONFLICT (match_id, player_id) DO NOTHING""",
            (
                match_db_id,
                player_id,
                our_team_id,
                ps["minutes_played"],
                ps["goals"],
                ps["shots_total"],
                ps["shots_on_target"],
                ps["shots_off_target"],
                ps["xg"],
                ps["xgot"],
                ps["assists"],
                ps["xa"],
                ps["key_passes"],
                ps["touches"],
                ps["passes_total"],
                ps["passes_completed"],
                ps["successful_dribbles"],
                ps["failed_dribbles"],
                ps["fouls_won"],
                ps["aerial_duels_won"],
                ps["aerial_duels_lost"],
                ps["ground_duels_won"],
                ps["ground_duels_lost"],
                ps["tackles_won"],
                ps["interceptions"],
                ps["offsides"],
                ps["fouls_committed"],
                ps["yellow_cards"],
                ps["red_cards"],
                ps["sofascore_rating"],
                ps["total_cross"],
                ps["accurate_cross"],
                ps["total_long_balls"],
                ps["accurate_long_balls"],
                ps["big_chance_created"],
                ps["big_chance_missed"],
                ps["hit_woodwork"],
                ps["blocked_scoring_attempt"],
                ps["clearances"],
                ps["head_clearance"],
                ps["outfielder_block"],
                ps["ball_recovery"],
                ps["error_lead_to_goal"],
                ps["error_lead_to_shot"],
                ps["possession_lost_ctrl"],
                ps["total_contest"],
                ps["penalty_won"],
                ps["penalty_conceded"],
                ps["own_goals"],
                ps["penalty_goals"],
                ps["np_xg"],
                ps["np_shots"],
                ps["accurate_own_half_passes"],
                ps["total_own_half_passes"],
                ps["accurate_opposition_half_passes"],
                ps["total_opposition_half_passes"],
                ps["pass_value_normalized"],
                ps["total_ball_carries_distance"],
                ps["total_progressive_ball_carries_distance"],
            ),
        )

        gk = ps.get("gk_stats")
        if gk:
            db.execute(
                """INSERT INTO match_gk_stats
                   (match_id, player_id, team_id, minutes_played,
                    saves, punches, goals_prevented, good_high_claim,
                    saves_inside_box, diving_save, goals_conceded,
                    touches, passes_total, passes_completed,
                    total_long_balls, accurate_long_balls,
                    aerial_duels_won, aerial_duels_lost,
                    clearances, ball_recovery,
                    error_lead_to_goal, error_lead_to_shot,
                    penalty_conceded, sofascore_rating)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                   ON CONFLICT (match_id, player_id) DO NOTHING""",
                (
                    match_db_id,
                    player_id,
                    our_team_id,
                    ps["minutes_played"],
                    gk["saves"],
                    gk["punches"],
                    gk["goals_prevented"],
                    gk["good_high_claim"],
                    gk["saves_inside_box"],
                    gk["diving_save"],
                    gk["goals_conceded"],
                    ps["touches"],
                    ps["passes_total"],
                    ps["passes_completed"],
                    ps["total_long_balls"],
                    ps["accurate_long_balls"],
                    ps["aerial_duels_won"],
                    ps["aerial_duels_lost"],
                    ps["clearances"],
                    ps["ball_recovery"],
                    ps["error_lead_to_goal"],
                    ps["error_lead_to_shot"],
                    ps["penalty_conceded"],
                    ps["sofascore_rating"],
                ),
            )

    log.info(f"Stored {len(player_stats)} player stat records for match {sofascore_id}")

    for player_id, sofascore_player_id in players_to_update:
        _fill_player_profile(db, player_id, sofascore_player_id, detail)

    _store_match_team_stats(db, sofascore_id, match_db_id, home_team_id, away_team_id)

    try:
        _store_match_odds(db, sofascore_id, match_db_id)
    except Exception as e:
        log.debug(f"Could not store odds for match {sofascore_id}: {e}")

    try:
        _store_shotmap(db, sofascore_id, match_db_id, player_stats, team_id_map)
    except Exception as e:
        log.debug(f"Could not store shotmap for match {sofascore_id}: {e}")

    return True


def _store_match_team_stats(
    db: DB, sofascore_id: int, match_db_id: int, home_team_id: int, away_team_id: int
):
    team_stats = fetch_match_statistics(sofascore_id)
    if len(team_stats) != 2:
        return

    for team_id, stats in zip([home_team_id, away_team_id], team_stats):
        db.execute(
            """INSERT INTO match_team_stats
               (match_id, team_id, possession_pct, total_shots, shots_on_target,
                corners, fouls, offsides_team, expected_goals, big_chances,
                big_chances_missed, accurate_passes, total_passes,
                tackles, interceptions, saves_team,
                final_third_entries, final_third_phase_stats)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
               ON CONFLICT (match_id, team_id) DO NOTHING""",
            (
                match_db_id,
                team_id,
                stats["possession_pct"],
                stats["total_shots"],
                stats["shots_on_target"],
                stats["corners"],
                stats["fouls"],
                stats["offsides_team"],
                stats["expected_goals"],
                stats["big_chances"],
                stats["big_chances_missed"],
                stats["accurate_passes"],
                stats["total_passes"],
                stats["tackles"],
                stats["interceptions"],
                stats["saves_team"],
                stats["final_third_entries"],
                stats["final_third_phase_stats"],
            ),
        )


def _store_match_odds(db: DB, sofascore_id: int, match_db_id: int):
    odds = fetch_match_odds(sofascore_id)
    if not odds:
        return

    db.execute(
        """INSERT INTO match_odds (match_id, home_win, draw, away_win)
           VALUES (%s, %s, %s, %s)
           ON CONFLICT (match_id) DO NOTHING""",
        (match_db_id, odds.get("home_win"), odds.get("draw"), odds.get("away_win")),
    )


def _store_shotmap(
    db: DB,
    sofascore_id: int,
    match_db_id: int,
    player_stats: list[dict],
    team_id_map: dict,
):
    shots = fetch_shotmap(sofascore_id)
    if not shots:
        return

    player_id_cache = {}
    for ps in player_stats:
        row = db.query_one(
            "SELECT id FROM players WHERE sofascore_id = %s",
            (ps["sofascore_player_id"],),
        )
        if row:
            player_id_cache[ps["sofascore_player_id"]] = row["id"]

    for shot in shots:
        player_db_id = player_id_cache.get(shot["player_sofascore_id"])
        if not player_db_id:
            continue

        db.execute(
            """INSERT INTO shots
               (match_id, player_id, minute, x, y, xg, result,
                situation, body_part, goal_mouth_y, goal_mouth_z,
                sofascore_id, source)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'sofascore')
               ON CONFLICT DO NOTHING""",
            (
                match_db_id,
                player_db_id,
                shot["minute"],
                shot["x"],
                shot["y"],
                shot["xg"],
                shot["result"],
                shot["situation"],
                shot["body_part"],
                shot["goal_mouth_y"],
                shot["goal_mouth_z"],
                shot["sofascore_id"],
            ),
        )


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Know Ball match scraper")
    parser.add_argument(
        "--league",
        type=int,
        help="FotMob league ID (e.g. 47=PL, 48=Champ, 87=LaLiga, 53=L1, 55=SerieA, 54=BL)",
    )
    parser.add_argument(
        "--season",
        type=str,
        default=CURRENT_SEASON,
        help="Season string (e.g. 2025/2026, 24/25, 2024-2025)",
    )
    parser.add_argument(
        "--list-seasons",
        type=int,
        metavar="LEAGUE_ID",
        help="List available seasons for a league",
    )
    parser.add_argument(
        "--recent-days",
        type=int,
        default=0,
        help="Only scrape completed matches from the previous N day(s)",
    )
    args = parser.parse_args()

    # Handle --list-seasons
    if args.list_seasons:
        tournament_id = TOURNAMENT_IDS.get(args.list_seasons)
        if not tournament_id:
            log.error(f"No mapping for league {args.list_seasons}")
            log.info(f"Available leagues: {[(name, fid) for name, fid, _ in LEAGUES]}")
            return

        print(f"\nAvailable seasons for league {args.list_seasons}:")
        seasons = list_available_seasons(tournament_id)
        for s in seasons:
            print(f"  {s['name']} (ID: {s['id']})")
        print()
        return

    leagues = LEAGUES
    if args.league:
        leagues = [l for l in LEAGUES if l[1] == args.league]
        if not leagues:
            log.error(f"Unknown FotMob league ID: {args.league}")
            log.info(f"Available: {[(name, fid) for name, fid, _ in LEAGUES]}")
            return

    log.info("Starting Know Ball scrape (Sofascore)")

    clear_player_cache()

    db = DB()
    existing_ids = get_existing_match_ids(db)
    print(f"Existing matches: {len(existing_ids)}")

    if args.recent_days > 0:
        if args.league:
            log.warning("--league is ignored with --recent-days; scheduled events are filtered by configured leagues")
        try:
            scrape_recent_matches(db, args.season, args.recent_days, existing_ids)
        except Exception as e:
            log.error(f"Failed to scrape recent matches: {e}")
            import traceback

            traceback.print_exc()
            raise
    else:
        failed_leagues = []
        for league_name, fotmob_id, understat_slug in leagues:
            try:
                scrape_league(
                    db,
                    league_name,
                    fotmob_id,
                    understat_slug,
                    args.season,
                    existing_ids,
                )
                clear_player_cache()
            except Exception as e:
                log.error(f"Failed to scrape {league_name}: {e}")
                import traceback

                traceback.print_exc()
                failed_leagues.append(league_name)
                continue

    db.close()
    if args.recent_days == 0 and failed_leagues:
        raise RuntimeError(f"Failed to scrape leagues: {', '.join(failed_leagues)}")
    log.info("Scrape complete")


if __name__ == "__main__":
    main()
