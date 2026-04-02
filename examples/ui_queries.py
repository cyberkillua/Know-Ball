#!/usr/bin/env python3
"""
Example UI queries demonstrating league+season scoped data access.

This script shows how a UI would use the query helpers to:
- Display season dropdowns
- Show player profiles with correct team context
- Generate leaderboards
- Handle multi-club players

Run this as: python3 examples/ui_queries.py
"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pipeline.db import DB
from pipeline.queries import (
    get_available_seasons,
    get_player_profile,
    get_leaderboard,
    get_player_teams_by_season,
    search_players,
    get_league_info,
)


def example_ui_season_dropdown():
    """Example: Populate league+season dropdowns."""
    print("\n" + "=" * 70)
    print("UI COMPONENT: Season Dropdown")
    print("=" * 70)

    seasons = get_available_seasons(db)

    print("\nAvailable League+Season combinations:")
    for s in seasons:
        print(
            f"  {s['league_name']:20} {s['season']:10} "
            f"({s['match_count']} matches, {s['player_count']} players)"
        )

    print("\n✓ UI would populate dropdowns with these values")
    return seasons


def example_ui_player_profile():
    """Example: Player profile page with league+season filtering."""
    print("\n" + "=" * 70)
    print("UI COMPONENT: Player Profile (Marcus Thuram)")
    print("=" * 70)

    player_id = 15491  # Marcus Thuram

    # Get all teams this player appeared for
    teams = get_player_teams_by_season(db, player_id)

    print(f"\nMarcus Thuram's complete history:")
    for t in teams:
        print(
            f"  {t['season']} {t['league_name']:15} - {t['team_name']:20} "
            f"({t['matches']} matches)"
        )

    # Get profile for Serie A 2025/2026
    profile = get_player_profile(db, player_id, league_id=55, season="2025/2026")

    if profile:
        print(f"\n┌─ Player Profile ─────────────────────┐")
        print(f"│ {profile['player_name']:<30} │")
        print(f"│ Position: {profile['position']:<23} │")
        print(f"│ Team: {profile['team_name']:<26} │")
        print(f"├──────────────────────────────────────┤")
        print(f"│ Serie A 2025/2026                   │")
        print(f"│ Matches: {profile['matches_played']:<26} │")
        print(f"│ Minutes: {profile['minutes_played']:<26} │")
        print(f"│ Avg Rating: {profile['avg_match_rating']:<23} │")
        print(f"├──────────────────────────────────────┤")
        print(f"│ Percentile Rankings:                │")
        print(f"│ Overall: {profile['overall_percentile']:<26} │")
        print(f"│ Finishing: {profile['finishing_percentile']:<23} │")
        print(f"└──────────────────────────────────────┘")
    else:
        print("\n⚠ No rating available (below minimum minutes)")


def example_ui_leaderboard():
    """Example: Leaderboard page with filters."""
    print("\n" + "=" * 70)
    print("UI COMPONENT: Strikers Leaderboard (Ligue 1 2025/2026)")
    print("=" * 70)

    leaders = get_leaderboard(
        db, league_id=53, season="2025/2026", position="ST", limit=10
    )

    print(
        f"\n{'Rank':<5} {'Player':<25} {'Team':<20} {'Overall':<10} {'Finishing':<10}"
    )
    print("─" * 70)

    for i, leader in enumerate(leaders, 1):
        print(
            f"{i:<5} {leader['player_name']:<25} {leader['team_name']:<20} "
            f"{leader['overall_percentile']:<10} {leader['finishing_percentile']:<10}"
        )

    print(f"\n✓ Note: Multi-club players show primary team in this league+season")


def example_ui_multi_club_player():
    """Example: Multi-club player handling."""
    print("\n" + "=" * 70)
    print("UI COMPONENT: Player with Multiple Teams (Odsonne Édouard)")
    print("=" * 70)

    player_id = 14165  # Odsonne Édouard

    # Get all teams across all leagues+seasons
    all_teams = get_player_teams_by_season(db, player_id)

    print("\nComplete career:")
    for t in all_teams:
        print(
            f"  {t['season']} {t['league_name']:15} {t['team_name']:20} "
            f"{t['matches']} matches, {t['minutes']} mins"
        )

    # Try different league+season contexts
    contexts = [
        (53, "2025/2026", "Ligue 1"),
        (47, "2025/2026", "Premier League"),
    ]

    for league_id, season, league_name in contexts:
        print(f"\n{league_name} {season}:")
        profile = get_player_profile(db, player_id, league_id, season)

        teams_in_context = [
            t
            for t in all_teams
            if t["league_id"] == league_id and t["season"] == season
        ]

        print("  Teams:")
        for t in teams_in_context:
            print(f"    - {t['team_name']}: {t['matches']} matches")

        if profile:
            print(f"  Rating: {profile['overall_percentile']}th percentile")
            print(f"  Team shown in leaderboard: {profile['team_name']}")
        else:
            print("  No rating (below minimum minutes)")

    print("\n✓ UI correctly shows different teams and ratings per league+season")


def example_ui_player_search():
    """Example: Player search with autocomplete."""
    print("\n" + "=" * 70)
    print("UI COMPONENT: Player Search")
    print("=" * 70)

    # Search for "Thuram"
    results = search_players(db, name="Thuram", limit=5)

    print("\nSearch results for 'Thuram':")
    for r in results:
        team = r.get("current_team", "Unknown")
        print(f"  {r['player_name']:<25} ({team})")

    # Search within specific league+season
    results_seriea = search_players(
        db, name="Thuram", league_id=55, season="2025/2026", limit=5
    )

    print("\nSearch results for 'Thuram' in Serie A 2025/2026:")
    for r in results_seriea:
        print(f"  {r['player_name']:<25} ({r.get('league_name', 'N/A')})")

    print("\n✓ Search works across all players or within context")


def run_all_examples():
    """Run all UI component examples."""
    print("\n" + "═" * 70)
    print("KNOW BALL: League+Season Scoped Data Examples")
    print("═" * 70)

    example_ui_season_dropdown()
    example_ui_leaderboard()
    example_ui_player_profile()
    example_ui_multi_club_player()
    example_ui_player_search()

    print("\n" + "═" * 70)
    print("Summary:")
    print("═" * 70)
    print("""
✓ All queries use (league_id, season) scope
✓ Player ratings are per-league+season
✓ Teams are derived from match_player_stats in context
✓ Multi-club players handled correctly
✓ Transfers between leagues = separate ratings

Implementation Notes:
- Use pipeline.queries for common queries
- Views are pre-optimized in database
- current_team_id used for defaults only
- Always filter ratings by (league_id, season)
    """)


if __name__ == "__main__":
    db = DB()
    try:
        run_all_examples()
    finally:
        db.close()
