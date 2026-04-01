"""
Main scraping entrypoint.

Fetches new matches and player stats from Sofascore,
then stores them in Postgres. Designed to run daily via GitHub Actions.
"""

from pipeline.db import DB
from pipeline.logger import get_logger
from pipeline.scrapers.sofascore import (
    fetch_league_matches,
    fetch_match_details,
    extract_player_stats,
    fetch_player_profile,
    fetch_match_statistics,
    fetch_standings,
    fetch_match_odds,
    fetch_shotmap,
    get_current_season_id,
    TOURNAMENT_IDS,
)

log = get_logger("scrape")

LEAGUES = [
    ("Premier League", 47, "EPL"),
    ("Championship", 48, None),
    ("La Liga", 87, "La_liga"),
    ("Ligue 1", 53, "Ligue_1"),
    ("Serie A", 55, "Serie_A"),
    ("Bundesliga", 54, "Bundesliga"),
]

CURRENT_SEASON = "2025/2026"


def get_existing_match_ids(db: DB) -> set[int]:
    """Get all existing Sofascore match IDs from the database."""
    rows = db.query("SELECT sofascore_id FROM matches WHERE sofascore_id IS NOT NULL")
    return {r["sofascore_id"] for r in rows}


def get_league_id(db: DB, fotmob_id: int) -> int | None:
    row = db.query_one("SELECT id FROM leagues WHERE fotmob_id = %s", (fotmob_id,))
    return row["id"] if row else None


def upsert_team(db: DB, name: str, sofascore_id: int, league_id: int) -> int:
    row = db.query_one("SELECT id FROM teams WHERE sofascore_id = %s", (sofascore_id,))
    if row:
        return row["id"]
    row = db.insert_returning(
        "INSERT INTO teams (name, sofascore_id, league_id) VALUES (%s, %s, %s) RETURNING id",
        (name, sofascore_id, league_id),
    )
    return row["id"]


def upsert_player(
    db: DB, name: str, sofascore_id: int, position: str, team_id: int
) -> int:
    row = db.query_one(
        "SELECT id, nationality FROM players WHERE sofascore_id = %s", (sofascore_id,)
    )
    if row:
        db.execute(
            "UPDATE players SET current_team_id = %s WHERE id = %s",
            (team_id, row["id"]),
        )
        if not row.get("nationality"):
            _fill_player_profile(db, row["id"], sofascore_id)
        return row["id"]
    row = db.insert_returning(
        "INSERT INTO players (name, sofascore_id, position, current_team_id) VALUES (%s, %s, %s, %s) RETURNING id",
        (name, sofascore_id, position, team_id),
    )
    _fill_player_profile(db, row["id"], sofascore_id)
    return row["id"]


def _fill_player_profile(db: DB, player_db_id: int, sofascore_id: int):
    """Fetch and store player profile data from Sofascore."""
    profile = fetch_player_profile(sofascore_id)
    if not profile:
        return
    db.execute(
        """UPDATE players
           SET nationality = COALESCE(%s, nationality),
               date_of_birth = COALESCE(%s, date_of_birth),
               height_cm = COALESCE(%s, height_cm),
               preferred_foot = COALESCE(%s, preferred_foot),
               shirt_number = COALESCE(%s, shirt_number),
               position = COALESCE(%s, position)
           WHERE id = %s""",
        (
            profile.get("nationality"),
            profile.get("date_of_birth"),
            profile.get("height_cm"),
            profile.get("preferred_foot"),
            profile.get("shirt_number"),
            profile.get("position"),
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
    skip_odds: bool = False,
    skip_shotmap: bool = False,
):
    league_id = get_league_id(db, fotmob_league_id)
    if not league_id:
        log.error(f"League not found in DB: {league_name}")
        return

    log.info(f"=== Scraping {league_name} ({season}) ===")

    # Fetch and store league standings (once per league per run)
    _store_standings(db, fotmob_league_id, league_id, season)

    matches = fetch_league_matches(fotmob_league_id, season)
    new_matches = [m for m in matches if m["sofascore_id"] not in existing_ids]
    log.info(f"{len(new_matches)} new matches to process")

    stats_ok = 0
    stats_skipped = 0
    for match in new_matches:
        try:
            got_stats = _process_match(
                db, match, league_id, season, skip_odds, skip_shotmap
            )
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


def _store_standings(db: DB, fotmob_league_id: int, league_id: int, season: str):
    """Fetch and store current league standings."""
    tournament_id = TOURNAMENT_IDS.get(fotmob_league_id)
    if not tournament_id:
        return

    season_id = get_current_season_id(tournament_id)
    if not season_id:
        return

    standings = fetch_standings(tournament_id, season_id)
    for row in standings:
        # Look up team by sofascore_id
        team_row = db.query_one(
            "SELECT id FROM teams WHERE sofascore_id = %s",
            (row["team_sofascore_id"],),
        )
        if not team_row:
            # Team might not exist yet; create it
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


def _process_match(
    db: DB,
    match: dict,
    league_id: int,
    season: str,
    skip_odds: bool = False,
    skip_shotmap: bool = False,
) -> bool:
    """Process a match. Returns True if player stats were stored, False otherwise."""
    sofascore_id = match["sofascore_id"]
    log.info(
        f"Processing match {sofascore_id}: {match['home_team']} vs {match['away_team']}"
    )

    home_team_id = upsert_team(db, match["home_team"], match["home_team_id"], league_id)
    away_team_id = upsert_team(db, match["away_team"], match["away_team_id"], league_id)

    match_row = db.insert_returning(
        """INSERT INTO matches (league_id, season, matchday, date, home_team_id, away_team_id, home_score, away_score, sofascore_id)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id""",
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

    player_stats = extract_player_stats(detail, match)

    team_id_map = {
        match["home_team_id"]: home_team_id,
        match["away_team_id"]: away_team_id,
    }

    for ps in player_stats:
        our_team_id = team_id_map.get(ps["team_id"], home_team_id)
        player_id = upsert_player(
            db,
            ps["name"],
            ps["sofascore_player_id"],
            ps["position_played"],
            our_team_id,
        )

        db.execute(
            """INSERT INTO match_player_stats
               (match_id, player_id, team_id, minutes_played, position_played,
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
                penalty_won, penalty_conceded, own_goals)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
               ON CONFLICT (match_id, player_id) DO NOTHING""",
            (
                match_db_id,
                player_id,
                our_team_id,
                ps["minutes_played"],
                ps["position_played"],
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
            ),
        )

        # Insert GK-specific stats if this is a goalkeeper
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

    # Fetch and store team-level match statistics
    _store_match_team_stats(db, sofascore_id, match_db_id, home_team_id, away_team_id)

    # Fetch and store betting odds
    if not skip_odds:
        try:
            _store_match_odds(db, sofascore_id, match_db_id)
        except Exception as e:
            log.warning(f"Failed to store odds for match {sofascore_id}: {e}")

    # Fetch and store shot map
    if not skip_shotmap:
        _store_shotmap(db, sofascore_id, match_db_id, player_stats, team_id_map)

    return True


def _store_match_team_stats(
    db: DB, sofascore_id: int, match_db_id: int, home_team_id: int, away_team_id: int
):
    """Fetch and store team-level match statistics."""
    team_stats = fetch_match_statistics(sofascore_id)
    if len(team_stats) != 2:
        return

    for team_id, stats in zip([home_team_id, away_team_id], team_stats):
        db.execute(
            """INSERT INTO match_team_stats
               (match_id, team_id, possession_pct, total_shots, shots_on_target,
                corners, fouls, offsides_team, expected_goals, big_chances,
                big_chances_missed, accurate_passes, total_passes,
                tackles, interceptions, saves_team)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
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
            ),
        )


def _store_match_odds(db: DB, sofascore_id: int, match_db_id: int):
    """Fetch and store betting odds for a match."""
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
    """Fetch and store shot map data for a match."""
    shots = fetch_shotmap(sofascore_id)
    if not shots:
        return

    # Build a lookup from sofascore player ID to our DB player ID
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
        help="Season string (e.g. 2025/2026)",
    )
    parser.add_argument(
        "--skip-odds", action="store_true", help="Skip fetching betting odds"
    )
    parser.add_argument(
        "--skip-shotmap", action="store_true", help="Skip fetching shot map data"
    )
    args = parser.parse_args()

    leagues = LEAGUES
    if args.league:
        leagues = [l for l in LEAGUES if l[1] == args.league]
        if not leagues:
            log.error(f"Unknown FotMob league ID: {args.league}")
            log.info(f"Available: {[(name, fid) for name, fid, _ in LEAGUES]}")
            return

    log.info("Starting Know Ball scrape (Sofascore)")
    db = DB()
    existing_ids = get_existing_match_ids(db)
    print(f"Existing matches: {len(existing_ids)}")

    for league_name, fotmob_id, understat_slug in leagues:
        try:
            scrape_league(
                db,
                league_name,
                fotmob_id,
                understat_slug,
                args.season,
                existing_ids,
                skip_odds=args.skip_odds,
                skip_shotmap=args.skip_shotmap,
            )
        except Exception as e:
            log.error(f"Failed to scrape {league_name}: {e}")
            continue

    db.close()
    log.info("Scrape complete")


if __name__ == "__main__":
    main()
