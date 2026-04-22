"""
Query helpers for league+season scoped player data.

Provides functions for UI components:
- Get player profile for specific league+season
- Get leaderboard for specific league+season+position
- Get player's teams across all leagues+seasons
- Get available seasons for UI dropdowns

All queries use the league+season scope pattern established in the schema.
"""

from pipeline.db import DB
from typing import Optional


def get_player_profile(
    db: DB, player_id: int, league_id: int, season: str
) -> Optional[dict]:
    """
    Get player's rating and team context for specific league+season.

    Args:
        db: Database connection
        player_id: Player ID
        league_id: League ID (e.g., 47 for Premier League)
        season: Season string (e.g., "2025/2026")

    Returns:
        Dict with player info, team, and percentiles, or None if not found

    Example:
        >>> profile = get_player_profile(db, 14165, 53, "2025/2026")
        >>> profile['player_name']
        'Odsonne Édouard'
        >>> profile['team_name']
        'RC Lens'
        >>> profile['overall_percentile']
        68
    """
    return db.query_one(
        """
        SELECT * FROM player_league_season_profile
        WHERE player_id = %s
        AND league_id = %s
        AND season = %s
    """,
        (player_id, league_id, season),
    )


def get_leaderboard(
    db: DB,
    league_id: int,
    season: str,
    position: str,
    limit: int = 100,
    min_minutes: int = 300,
) -> list[dict]:
    """
    Get leaderboard for specific league+season+position.

    Args:
        db: Database connection
        league_id: League ID (e.g., 47 for Premier League)
        season: Season string (e.g., "2025/2026")
        position: Position code ('ST', 'GK', 'CB', etc.)
        limit: Maximum number of players to return
        min_minutes: Minimum minutes played threshold

    Returns:
        List of players with ratings and percentiles, sorted by overall percentile

    Example:
        >>> leaders = get_leaderboard(db, 53, "2025/2026", "ST", limit=10)
        >>> leaders[0]['player_name']
        'Marcus Thuram'
        >>> leaders[0]['overall_percentile']
        68
    """
    return db.query(
        """
        SELECT * FROM league_season_leaderboard
        WHERE league_id = %s
        AND season = %s
        AND position = %s
        AND minutes_played >= %s
        ORDER BY overall_percentile DESC
        LIMIT %s
    """,
        (league_id, season, position, min_minutes, limit),
    )


def get_player_seasons(db: DB, player_id: int) -> list[dict]:
    """
    Get all seasons where a player has played.

    Returns seasons grouped by league+season, with match and minute counts.
    Use this for player profile page season filter.

    Args:
        db: Database connection
        player_id: Player ID

    Returns:
        List of (league, season) dicts with match counts

    Example:
        >>> seasons = get_player_seasons(db, 14165)
        >>> seasons[0]
        {
            'league_id': 4,
            'league_name': 'Ligue 1',
            'season': '2025/2026',
            'matches': 23,
            'minutes': 1475
        }
    """
    return db.query(
        """
        SELECT DISTINCT
            l.id as league_id,
            l.name as league_name,
            m.season,
            COUNT(DISTINCT m.id) as matches,
            SUM(mps.minutes_played) as minutes
        FROM match_player_stats mps
        JOIN matches m ON m.id = mps.match_id
        JOIN leagues l ON l.id = m.league_id
        WHERE mps.player_id = %s
        GROUP BY l.id, l.name, m.season
        ORDER BY m.season DESC, l.name
    """,
        (player_id,),
    )


def get_player_teams_by_season(
    db: DB, player_id: int, season: Optional[str] = None
) -> list[dict]:
    """
    Get all teams a player appeared for, grouped by league+season.

    Args:
        db: Database connection
        player_id: Player ID
        season: Optional season filter (returns all seasons if None)

    Returns:
        List of (league, season, team, matches) dicts

    Example:
        >>> teams = get_player_teams_by_season(db, 14165)
        >>> teams[0]
        {
            'league_name': 'Ligue 1',
            'season': '2025/2026',
            'team_name': 'RC Lens',
            'matches': 23,
            'minutes': 1475
        }
    """
    if season:
        return db.query(
            """
            SELECT * FROM player_teams_by_season
            WHERE player_id = %s
            AND season = %s
            ORDER BY league_name
        """,
            (player_id, season),
        )
    else:
        return db.query(
            """
            SELECT * FROM player_teams_by_season
            WHERE player_id = %s
            ORDER BY season DESC, league_name
        """,
            (player_id,),
        )


def get_available_seasons(db: DB) -> list[dict]:
    """
    Get all available (league, season) combinations for UI dropdowns.

    Args:
        db: Database connection

    Returns:
        List of available seasons with match and player counts

    Example:
        >>> seasons = get_available_seasons(db)
        >>> seasons[0]
        {
            'league_id': 47,
            'league_name': 'Premier League',
            'season': '2025/2026',
            'match_count': 309,
            'player_count': 523
        }
    """
    return db.query("SELECT * FROM available_seasons")


def search_players(
    db: DB,
    name: str,
    league_id: Optional[int] = None,
    season: Optional[str] = None,
    limit: int = 10,
) -> list[dict]:
    """
    Search for players by name with optional league+season filter.

    Args:
        db: Database connection
        name: Player name search string
        league_id: Optional league filter
        season: Optional season filter
        limit: Maximum results

    Returns:
        List of matching players with team info

    Example:
        >>> players = search_players(db, "Thuram", league_id=55, season="2025/2026")
        >>> players[0]['player_name']
        'Marcus Thuram'
    """
    if league_id and season:
        return db.query(
            """
            SELECT DISTINCT
                p.id as player_id,
                p.name as player_name,
                t.name as current_team,
                l.name as league_name,
                pr.season,
                pr.position
            FROM players p
            LEFT JOIN teams t ON t.id = p.current_team_id
            CROSS JOIN leagues l
            LEFT JOIN peer_ratings pr ON pr.player_id = p.id
                AND pr.league_id = l.id
                AND pr.season = %s
                AND pr.peer_mode = 'dominant'
                AND pr.position_scope = ''
            WHERE (unaccent(p.name) ILIKE '%%' || unaccent(%s) || '%%'
               OR similarity(unaccent(lower(p.name)), unaccent(lower(%s))) > 0.3)
            AND l.id = %s
            ORDER BY p.name
            LIMIT %s
        """,
            (season, name, name, league_id, limit),
        )
    else:
        return db.query(
            """
            SELECT
                p.id as player_id,
                p.name as player_name,
                t.name as current_team,
                p.position
            FROM players p
            LEFT JOIN teams t ON t.id = p.current_team_id
            WHERE unaccent(p.name) ILIKE '%%' || unaccent(%s) || '%%'
               OR similarity(unaccent(lower(p.name)), unaccent(lower(%s))) > 0.3
            ORDER BY similarity(unaccent(lower(p.name)), unaccent(lower(%s))) DESC
            LIMIT %s
        """,
            (name, name, name, limit),
        )


def get_league_info(db: DB) -> list[dict]:
    """
    Get all leagues for UI league dropdown.

    Returns:
        List of leagues with IDs and names

    Example:
        >>> leagues = get_league_info(db)
        >>> leagues[0]
        {'id': 47, 'name': 'Premier League', 'country': 'England'}
    """
    return db.query("""
        SELECT id, name, country, fotmob_id
        FROM leagues
        ORDER BY tier, name
    """)


# Example usage for UI components
if __name__ == "__main__":
    db = DB()

    print("=== Available Seasons ===")
    seasons = get_available_seasons(db)
    for s in seasons[:5]:
        print(
            f"  {s['league_name']} {s['season']}: {s['match_count']} matches, {s['player_count']} players"
        )

    print("\n=== Player Profile (Édouard in Ligue 1 2025/2026) ===")
    profile = get_player_profile(db, 14165, 53, "2025/2026")
    if profile:
        print(f"  {profile['player_name']} ({profile['team_name']})")
        print(
            f"  Matches: {profile['matches_played']}, Minutes: {profile['minutes_played']}"
        )
        print(
            f"  Overall: {profile['overall_percentile']}%, Finishing: {profile['finishing_percentile']}%"
        )

    print("\n=== Ligue 1 ST Leaderboard (Top 5) ===")
    leaders = get_leaderboard(db, 53, "2025/2026", "ST", limit=5)
    for i, leader in enumerate(leaders, 1):
        print(
            f"  {i}. {leader['player_name']} ({leader['team_name']}): {leader['overall_percentile']}%"
        )

    print("\n=== Édouard's Teams by Season ===")
    teams = get_player_teams_by_season(db, 14165)
    for t in teams:
        print(
            f"  {t['season']} {t['league_name']}: {t['team_name']} ({t['matches']} matches)"
        )

    db.close()
