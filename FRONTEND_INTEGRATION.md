# Frontend Integration Guide

## Quick Start

All API endpoints are ready to use. Here's how to integrate with your frontend:

---

## Player Profile Page Filters

### GET /api/players/{id}/seasons

**Use this endpoint for player profile page season filter!**

Returns only the leagues+seasons where THIS specific player has played:

```javascript
// Example: GET /api/players/14165/seasons (Odsonne Édouard)
{
  "player_id": 14165,
  "seasons": [
    {
      "league_id": 4,
      "league_name": "Ligue 1",
      "season": "2025/2026",
      "matches": 23,
      "minutes": 1475,
      "label": "Ligue 1 2025/2026"  // ← Use this for dropdown display
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
```

### Frontend Implementation for Profile Page

```javascript
function PlayerProfile({ playerId }) {
  const [seasons, setSeasons] = useState([]);
  const [selectedSeason, setSelectedSeason] = useState(null);
  const [profile, setProfile] = useState(null);
  
  // 1. Load available seasons for THIS player
  useEffect(() => {
    fetch(`/api/players/${playerId}/seasons`)
      .then(r => r.json())
      .then(data => {
        setSeasons(data.seasons);
        // Auto-select first season (most recent)
        if (data.seasons.length > 0) {
          const first = data.seasons[0];
          setSelectedSeason({
            league_id: first.league_id,
            season: first.season
          });
        }
      });
  }, [playerId]);
  
  // 2. Load player profile when season changes
  useEffect(() => {
    if (selectedSeason) {
      fetch(`/api/players/${playerId}?league_id=${selectedSeason.league_id}&season=${selectedSeason.season}`)
        .then(r => r.json())
        .then(data => setProfile(data));
    }
  }, [playerId, selectedSeason]);
  
  return (
    <div>
      <h1>{profile?.player.name}</h1>
      
      {/* Season filter */}
      <select onChange={e => {
        const [league_id, season] = e.target.value.split('|');
        setSelectedSeason({ league_id: Number(league_id), season });
      }}>
        {seasons.map(s => (
          <option 
            key={`${s.league_id}-${s.season}`}
            value={`${s.league_id}|${s.season}`}
          >
            {s.label} ({s.matches} matches)
          </option>
        ))}
      </select>
      
      {/* Show current context */}
      <p>Team: {profile?.player.team}</p>
      <p>League: {profile?.player.league}</p>
      
      {/* Stats */}
      <div>Matches: {profile?.stats.matches}</div>
      <div>Overall: {profile?.percentiles.overall}%</div>
    </div>
  );
}
```

**Key Point**: The dropdown shows `"Ligue 1 2025/2026"`, not just `"2025/2026"`. This lets users pick the exact league+season context for that player.

---

## Leaderboard Page Filters (All Players)

### GET /api/leagues
Returns available leagues for the left dropdown:
```json
{
  "leagues": [
    {"id": 1, "name": "Premier League", "country": "England"},
    {"id": 4, "name": "Ligue 1", "country": "France"},
    {"id": 5, "name": "Serie A", "country": "Italy"}
  ]
}
```

### GET /api/seasons
Returns available season+league combinations:
```json
{
  "seasons": [
    {
      "league_id": 5,
      "league_name": "Serie A",
      "season": "2025/2026",
      "matches": 300,
      "players": 558,
      "label": "Serie A 2025/2026"  // ← Use this for display
    }
  ]
}
```

### Frontend Implementation

**Option A: Cascading Dropdowns**
```javascript
// 1. Load both leagues and seasons on mount
const [leagues, setLeagues] = useState([]);
const [seasons, setSeasons] = useState([]);
const [selectedLeague, setSelectedLeague] = useState(null);
const [selectedSeason, setSelectedSeason] = useState(null);

useEffect(() => {
  // Fetch leagues
  fetch('/api/leagues')
    .then(r => r.json())
    .then(data => setLeagues(data.leagues));
    
  // Fetch seasons
  fetch('/api/seasons')
    .then(r => r.json())
    .then(data => setSeasons(data.seasons));
}, []);

// 2. Filter seasons by selected league
const filteredSeasons = seasons.filter(s => s.league_id === selectedLeague);

// 3. Render dropdowns
return (
  <>
    <select onChange={e => setSelectedLeague(Number(e.target.value))}>
      {leagues.map(l => (
        <option key={l.id} value={l.id}>{l.name}</option>
      ))}
    </select>
    
    <select onChange={e => setSelectedSeason(e.target.value)}>
      {filteredSeasons.map(s => (
        <option key={s.season} value={s.season}>{s.label}</option>
      ))}
    </select>
  </>
);
```

**Option B: Single Dropdown**
```javascript
// Show all league+season combinations in one dropdown
return (
  <select onChange={e => {
    const [league_id, season] = e.target.value.split('|');
    setSelectedLeague(Number(league_id));
    setSelectedSeason(season);
  }}>
    {seasons.map(s => (
      <option 
        key={`${s.league_id}-${s.season}`} 
        value={`${s.league_id}|${s.season}`}
      >
        {s.label} ({s.matches} matches)
      </option>
    ))}
  </select>
);
```

---

## 2. Leaderboard Endpoint

### GET /api/leaderboard?league_id=5&season=2025/2026&position=ST

Returns ranked players for the selected context:

```json
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
      "goals_per90": 0.85
    }
  ]
}
```

### Display Example
```javascript
function Leaderboard({ league_id, season, position }) {
  const [players, setPlayers] = useState([]);
  
  useEffect(() => {
    fetch(`/api/leaderboard?league_id=${league_id}&season=${season}&position=${position}`)
      .then(r => r.json())
      .then(data => setPlayers(data.players));
  }, [league_id, season, position]);
  
  return (
    <table>
      <thead>
        <tr>
          <th>Rank</th>
          <th>Player</th>
          <th>Team</th>
          <th>Overall</th>
          <th>Finishing</th>
        </tr>
      </thead>
      <tbody>
        {players.map(p => (
          <tr key={p.player_id} onClick={() => navigate(`/player/${p.player_id}`)}>
            <td>{p.rank}</td>
            <td>{p.name}</td>
            <td>{p.team}</td>
            <td>{p.overall_percentile}%</td>
            <td>{p.finishing_percentile}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

---

## 3. Player Profile Endpoint

### GET /api/players/{id}?league_id=5&season=2025/2026

Returns player stats for specific league+season:

```json
{
  "player": {
    "id": 15491,
    "name": "Marcus Thuram",
    "position": "ST",
    "team": "Inter",              // ← Team in THIS league+season
    "league": "Serie A",
    "season": "2025/2026"
  },
  "stats": {
    "matches": 23,
    "minutes": 1479,
    "avg_rating": 6.9
  },
  "percentiles": {
    "overall": 90,
    "finishing": 74,
    "involvement": 88
  },
  "season_history": [             // ← All teams across all seasons
    {
      "season": "2025/2026",
      "league": "Serie A",
      "team": "Inter",
      "matches": 23
    }
  ]
}
```

### Display Example
```javascript
function PlayerProfile({ playerId, leagueId, season }) {
  const [profile, setProfile] = useState(null);
  
  useEffect(() => {
    fetch(`/api/players/${playerId}?league_id=${leagueId}&season=${season}`)
      .then(r => r.json())
      .then(data => setProfile(data));
  }, [playerId, leagueId, season]);
  
  if (!profile) return <div>Loading...</div>;
  
  return (
    <div className="player-card">
      <h1>{profile.player.name}</h1>
      <p className="team">{profile.player.team}</p>  {/* ← Shows "Inter" */}
      <p className="context">{profile.player.league} {profile.player.season}</p>
      
      <div className="percentiles">
        <div className="stat">
          <label>Overall</label>
          <span>{profile.percentiles.overall}%</span>
        </div>
        <div className="stat">
          <label>Finishing</label>
          <span>{profile.percentiles.finishing}%</span>
        </div>
      </div>
      
      <h3>Season History</h3>
      {profile.season_history.map(h => (
        <div key={`${h.season}-${h.league}`}>
          {h.season} {h.league}: {h.team} ({h.matches} matches)
        </div>
      ))}
    </div>
  );
}
```

---

## 4. Important: League ID Mapping

**Internal IDs vs FotMob IDs**

Your frontend should use **internal IDs** (1-6), not FotMob IDs:

| Display Name | Internal ID | FotMob ID |
|--------------|-------------|-----------|
| Premier League | 1 | 47 |
| Championship | 2 | 48 |
| La Liga | 3 | 87 |
| Ligue 1 | 4 | 53 |
| Serie A | 5 | 55 |
| Bundesliga | 6 | 54 |

**Use internal IDs for all API calls:**
```javascript
// ✗ Wrong (FotMob ID)
fetch(`/api/leaderboard?league_id=55&season=...`)  // Serie A FotMob ID

// ✓ Correct (Internal ID)
fetch(`/api/leaderboard?league_id=5&season=...`)   // Serie A internal ID
```

---

## 5. Position Filter

Common position values:
- `ST` - Strikers
- `CM` - Central Midfielders
- `CB` - Center Backs
- `GK` - Goalkeepers
- `LW` - Left Wingers
- `RW` - Right Wingers

---

## 6. Complete Example

```javascript
function App() {
  const [selectedLeague, setSelectedLeague] = useState(5);  // Serie A
  const [selectedSeason, setSelectedSeason] = useState('2025/2026');
  const [selectedPosition, setSelectedPosition] = useState('ST');
  
  return (
    <div>
      <Filters
        league={selectedLeague}
        season={selectedSeason}
        position={selectedPosition}
        onLeagueChange={setSelectedLeague}
        onSeasonChange={setSelectedSeason}
        onPositionChange={setSelectedPosition}
      />
      
      <Leaderboard
        league_id={selectedLeague}
        season={selectedSeason}
        position={selectedPosition}
      />
    </div>
  );
}
```

---

## Backend Endpoints Summary

| Endpoint | Parameters | Returns |
|----------|-----------|---------|
| `GET /api/leagues` | - | List of leagues |
| `GET /api/seasons` | - | List of season+league combos |
| `GET /api/leaderboard` | `league_id`, `season`, `position`, `limit` | Ranked players |
| `GET /api/players/{id}` | `league_id`, `season` | Player profile + stats |
| `GET /api/search` | `q` (query), `limit` | Search results |

---

## Data Flow

1. **Page Load** → Fetch `/api/leagues` and `/api/seasons`
2. **User Selects Filters** → Update `selectedLeague`, `selectedSeason`, `selectedPosition`
3. **Fetch Leaderboard** → `GET /api/leaderboard?league_id=5&season=2025/2026&position=ST`
4. **User Clicks Player** → Navigate to `/player/{id}?league_id=5&season=2025/2026`
5. **Fetch Player Profile** → `GET /api/players/15491?league_id=5&season=2025/2026`

---

## Next Steps

1. Create FastAPI/Flask routes using `API_ENDPOINTS.py`
2. Add authentication if needed
3. Implement caching for `/api/seasons` (changes infrequently)
4. Add pagination to `/api/leaderboard` if showing > 50 players
5. Add error handling for below-minimum-minutes players

---

## Testing

Run the examples:
```bash
python3 API_ENDPOINTS.py
```

Expected output:
```
API Endpoint Examples
======================================================================

1. GET /api/leagues
   Returns 6 leagues
   - 6: Bundesliga (Germany)
   - 3: La Liga (Spain)
   - 4: Ligue 1 (France)

2. GET /api/seasons
   Returns 7 season+league combinations
   - Bundesliga 2025/2026: 243 matches, 484 players
   - La Liga 2025/2026: 290 matches, 566 players
   - Ligue 1 2025/2026: 242 matches, 529 players

3. GET /api/leaderboard?league_id=5&season=2025/2026&position=ST
   Returns top 3 players
   1. Lautaro Martínez (Inter): 99%
   2. Sebastiano Esposito (Cagliari): 98%
   3. Keinan Davis (Udinese): 96%

4. GET /api/players/15491?league_id=5&season=2025/2026
   Marcus Thuram (Inter)
   Overall: 90%
   Matches: 23, Minutes: 1479
```