"""
API Endpoints for Frontend

This file shows the exact API response structures for frontend integration.
Use these endpoints/queries to populate your UI filters.
"""

from pipeline.db import DB
from pipeline.queries import (
    get_available_seasons,
    get_league_info,
    get_leaderboard,
    get_player_profile,
    get_player_teams_by_season,
    search_players,
)


# ============================================================
# ENDPOINT: GET /api/players/{id}/seasons
# Returns seasons where THIS player has played (for profile page filter)
# ============================================================

def get_player_seasons_endpoint(player_id: int):
    """
    GET /api/players/{id}/seasons
    
    Returns only the leagues+seasons where this player has match data.
    Use this for the player profile page season filter.
    """
    db = DB()
    
    # Get all seasons where this player has played
    seasons = db.query("""
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
    """, (player_id,))
    
    db.close()
    
    return {
        "player_id": player_id,
        "seasons": [
            {
                "league_id": s["league_id"],
                "league_name": s["league_name"],
                "season": s["season"],
                "matches": s["matches"],
                "minutes": s["minutes"],
                "label": f"{s['league_name']} {s['season']}"  # Combined for display
            }
            for s in seasons
        ]
    }

# Response example for Marcus Thuram:
{
  "player_id": 15491,
  "seasons": [
    {
      "league_id": 5,
      "league_name": "Serie A",
      "season": "2025/2026",
      "matches": 23,
      "minutes": 1479,
      "label": "Serie A 2025/2026"  // ← Use this for dropdown
    }
  ]
}

# Response example for Odsonne Édouard:
{
  "player_id": 14165,
  "seasons": [
    {
      "league_id": 4,
      "league_name": "Ligue 1",
      "season": "2025/2026",
      "matches": 23,
      "minutes": 1475,
      "label": "Ligue 1 2025/2026"
    },
    {
      "league_id": 1,
      "league_name": "Premier League",
      "season": "2025/2026",
      "matches": 1,
      "minutes": 8,
      "label": "Premier League 2025/2026"
    },
    {
      "league_id": 1,
      "league_name": "Premier League",
      "season": "2024/2025",
      "matches": 6,
      "minutes": 153,
      "label": "Premier League 2024/2025"
    }
  ]
}


# ============================================================
# ENDPOINT 1: GET /api/leagues
# Returns list of available leagues for dropdown
# ============================================================


def get_leagues_endpoint():
    """GET /api/leagues"""
    db = DB()
    leagues = get_league_info(db)
    db.close()

    return {
        "leagues": [
            {"id": league["id"], "name": league["name"], "country": league["country"]}
            for league in leagues
        ]
    }


# Response example:
{
    "leagues": [
        {"id": 1, "name": "Premier League", "country": "England"},
        {"id": 2, "name": "Championship", "country": "England"},
        {"id": 3, "name": "La Liga", "country": "Spain"},
        {"id": 4, "name": "Ligue 1", "country": "France"},
        {"id": 5, "name": "Serie A", "country": "Italy"},
        {"id": 6, "name": "Bundesliga", "country": "Germany"},
    ]
}


# ============================================================
# ENDPOINT 2: GET /api/seasons
# Returns available season+league combinations for filtering
# ============================================================


def get_seasons_endpoint():
    """GET /api/seasons"""
    db = DB()
    seasons = get_available_seasons(db)
    db.close()

    return {
        "seasons": [
            {
                "league_id": season["league_id"],
                "league_name": season["league_name"],
                "season": season["season"],
                "matches": season["match_count"],
                "players": season["player_count"],
                "label": f"{season['league_name']} {season['season']}",
            }
            for season in seasons
        ]
    }


# Response example:
{
    "seasons": [
        {
            "league_id": 5,
            "league_name": "Serie A",
            "season": "2025/2026",
            "matches": 300,
            "players": 558,
            "label": "Serie A 2025/2026",
        },
        {
            "league_id": 4,
            "league_name": "Ligue 1",
            "season": "2025/2026",
            "matches": 242,
            "players": 529,
            "label": "Ligue 1 2025/2026",
        },
        {
            "league_id": 1,
            "league_name": "Premier League",
            "season": "2025/2026",
            "matches": 309,
            "players": 521,
            "label": "Premier League 2025/2026",
        },
    ]
}


# ============================================================
# ENDPOINT 3: GET /api/leaderboard?league_id=X&season=Y&position=Z
# Returns ranked players for specific league+season+position
# ============================================================


def get_leaderboard_endpoint(
    league_id: int, season: str, position: str, limit: int = 50
):
    """GET /api/leaderboard?league_id=5&season=2025/2026&position=ST"""
    db = DB()
    leaders = get_leaderboard(db, league_id, season, position, limit)
    db.close()

    return {
        "league_id": league_id,
        "season": season,
        "position": position,
        "players": [
            {
                "rank": idx + 1,
                "player_id": player["player_id"],
                "name": player["player_name"],
                "team": player["team_name"],
                "matches": player["matches_played"],
                "minutes": player["minutes_played"],
                "overall_percentile": player["overall_percentile"],
                "finishing_percentile": player["finishing_percentile"],
                "goals_per90": float(player["goals_per90"])
                if player.get("goals_per90")
                else None,
                "xg_per90": float(player["xg_per90"])
                if player.get("xg_per90")
                else None,
            }
            for idx, player in enumerate(leaders)
        ],
    }


# Response example (Serie A 2025/2026 ST):
{
    "league_id": 5,
    "season": "2025/2026",
    "position": "ST",
    "players": [
        {
            "rank": 1,
            "player_id": 12345,
            "name": "Lautaro Martínez",
            "team": "Inter",
            "matches": 23,
            "minutes": 1479,
            "overall_percentile": 99,
            "finishing_percentile": 98,
            "goals_per90": 0.85,
            "xg_per90": 0.78,
        },
        {
            "rank": 2,
            "player_id": 67890,
            "name": "Sebastiano Esposito",
            "team": "Cagliari",
            "matches": 18,
            "minutes": 1120,
            "overall_percentile": 98,
            "finishing_percentile": 95,
            "goals_per90": 0.72,
            "xg_per90": 0.65,
        },
    ],
}


# ============================================================
# ENDPOINT 4: GET /api/players/{id}?league_id=X&season=Y
# Returns player profile for specific league+season
# ============================================================


def get_player_profile_endpoint(player_id: int, league_id: int, season: str):
    """GET /api/players/15491?league_id=5&season=2025/2026"""
    db = DB()

    # Get player profile
    profile = get_player_profile(db, player_id, league_id, season)

    if not profile:
        db.close()
        return {"error": "Player not found or below minimum minutes"}

    # Get all teams this player played for (across all leagues+seasons)
    all_teams = get_player_teams_by_season(db, player_id)

    db.close()

    return {
        "player": {
            "id": player_id,
            "name": profile["player_name"],
            "position": profile["position"],
            "team": profile["team_name"],  # Team in THIS league+season
            "league": profile["league_name"],
            "season": profile["season"],
        },
        "stats": {
            "matches": profile["matches_played"],
            "minutes": profile["minutes_played"],
            "avg_rating": float(profile["avg_match_rating"])
            if profile.get("avg_match_rating")
            else None,
        },
        "percentiles": {
            "overall": profile["overall_percentile"],
            "finishing": profile["finishing_percentile"],
            "involvement": profile["involvement_percentile"],
            "carrying": profile["carrying_percentile"],
            "physical": profile["physical_percentile"],
            "pressing": profile["pressing_percentile"],
        },
        "per_90": {
            "goals": float(profile["goals_per90"])
            if profile.get("goals_per90")
            else None,
            "xg": float(profile["xg_per90"]) if profile.get("xg_per90") else None,
            "xa": float(profile["xa_per90"]) if profile.get("xa_per90") else None,
        },
        "season_history": [
            {
                "season": team["season"],
                "league": team["league_name"],
                "team": team["team_name"],
                "matches": team["matches"],
                "minutes": team["minutes"],
            }
            for team in all_teams
        ],
    }


# Response example (Marcus Thuram):
{
    "player": {
        "id": 15491,
        "name": "Marcus Thuram",
        "position": "ST",
        "team": "Inter",
        "league": "Serie A",
        "season": "2025/2026",
    },
    "stats": {"matches": 23, "minutes": 1479, "avg_rating": 6.9},
    "percentiles": {
        "overall": 90,
        "finishing": 74,
        "involvement": 88,
        "carrying": 72,
        "physical": 68,
        "pressing": 85,
    },
    "per_90": {"goals": 0.65, "xg": 0.58, "xa": 0.12},
    "season_history": [
        {
            "season": "2025/2026",
            "league": "Serie A",
            "team": "Inter",
            "matches": 23,
            "minutes": 1479,
        }
    ],
}


# ============================================================
# ENDPOINT 5: GET /api/search?q=X
# Search for players by name
# ============================================================


def search_players_endpoint(query: str, limit: int = 10):
    """GET /api/search?q=thuram"""
    db = DB()
    results = search_players(db, name=query, limit=limit)
    db.close()

    return {
        "query": query,
        "results": [
            {
                "player_id": player["player_id"],
                "name": player["player_name"],
                "team": player.get("current_team"),
                "position": player.get("position"),
            }
            for player in results
        ],
    }


# Response example:
{
    "query": "thuram",
    "results": [
        {
            "player_id": 15491,
            "name": "Marcus Thuram",
            "team": "Inter",
            "position": "ST",
        },
        {
            "player_id": 15429,
            "name": "Khéphren Thuram",
            "team": "Juventus",
            "position": "CM",
        },
    ],
}


# ============================================================
# EXAMPLE: Frontend Implementation
# ============================================================

"""
REACT COMPONENT EXAMPLE:

import { useState, useEffect } from 'react';

function Leaderboard() {
  const [leagues, setLeagues] = useState([]);
  const [seasons, setSeasons] = useState([]);
  const [selectedLeague, setSelectedLeague] = useState(null);
  const [selectedSeason, setSelectedSeason] = useState(null);
  const [selectedPosition, setSelectedPosition] = useState('ST');
  const [players, setPlayers] = useState([]);
  
  // Load leagues on mount
  useEffect(() => {
    fetch('/api/leagues')
      .then(r => r.json())
      .then(data => setLeagues(data.leagues));
      
    fetch('/api/seasons')
      .then(r => r.json())
      .then(data => setSeasons(data.seasons));
  }, []);
  
  // Load leaderboard when filters change
  useEffect(() => {
    if (selectedLeague && selectedSeason) {
      fetch(`/api/leaderboard?league_id=${selectedLeague}&season=${selectedSeason}&position=${selectedPosition}`)
        .then(r => r.json())
        .then(data => setPlayers(data.players));
    }
  }, [selectedLeague, selectedSeason, selectedPosition]);
  
  return (
    <div>
      <select onChange={e => setSelectedLeague(e.target.value)}>
        {leagues.map(l => (
          <option key={l.id} value={l.id}>{l.name}</option>
        ))}
      </select>
      
      <select onChange={e => setSelectedSeason(e.target.value)}>
        {seasons
          .filter(s => s.league_id === selectedLeague)
          .map(s => (
            <option key={s.season} value={s.season}>{s.label}</option>
          ))}
      </select>
      
      <select onChange={e => setSelectedPosition(e.target.value)}>
        <option value="ST">Strikers</option>
        <option value="CM">Midfielders</option>
        <option value="CB">Defenders</option>
      </select>
      
      <table>
        {players.map(p => (
          <tr key={p.player_id}>
            <td>{p.rank}</td>
            <td>{p.name}</td>
            <td>{p.team}</td>
            <td>{p.overall_percentile}%</td>
          </tr>
        ))}
      </table>
    </div>
  );
}
"""

if __name__ == "__main__":
    print("API Endpoint Examples")
    print("=" * 70)

    # Example 1: Get leagues
    print("\n1. GET /api/leagues")
    result = get_leagues_endpoint()
    print(f"   Returns {len(result['leagues'])} leagues")
    for l in result["leagues"][:3]:
        print(f"   - {l['id']}: {l['name']} ({l['country']})")

    # Example 2: Get seasons
    print("\n2. GET /api/seasons")
    result = get_seasons_endpoint()
    print(f"   Returns {len(result['seasons'])} season+league combinations")
    for s in result["seasons"][:3]:
        print(f"   - {s['label']}: {s['matches']} matches, {s['players']} players")

    # Example 3: Get leaderboard
    print("\n3. GET /api/leaderboard?league_id=5&season=2025/2026&position=ST")
    result = get_leaderboard_endpoint(
        league_id=5, season="2025/2026", position="ST", limit=3
    )
    print(f"   Returns top {len(result['players'])} players")
    for p in result["players"]:
        print(f"   {p['rank']}. {p['name']} ({p['team']}): {p['overall_percentile']}%")

    # Example 4: Get player profile
    print("\n4. GET /api/players/15491?league_id=5&season=2025/2026")
    result = get_player_profile_endpoint(
        player_id=15491, league_id=5, season="2025/2026"
    )
    if "player" in result:
        print(f"   {result['player']['name']} ({result['player']['team']})")
        print(f"   Overall: {result['percentiles']['overall']}%")
        print(
            f"   Matches: {result['stats']['matches']}, Minutes: {result['stats']['minutes']}"
        )
