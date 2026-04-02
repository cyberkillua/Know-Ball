# Player Profile Page Implementation

## The Problem

On a player profile page, showing just "2024/2025" and "2025/2026" in the season filter is confusing because players can play in multiple leagues within the same season.

**Example**:
- Odsonne Édouard played in:
  - Ligue 1 2025/2026 (RC Lens)
  - Premier League 2025/2026 (Crystal Palace)
  - Premier League 2024/2025 (multiple teams)

If we only showed "2025/2026" in the dropdown, the user wouldn't know which league context they're viewing.

**Solution**: Show full context like "Ligue 1 2025/2026" and "Premier League 2025/2026".

---

## New Endpoint

### `GET /api/players/{id}/seasons`

Returns only the leagues+seasons where THIS player has played:

```bash
# Get Marcus Thuram's seasons
GET /api/players/15491/seasons

# Response:
{
  "player_id": 15491,
  "seasons": [
    {
      "league_id": 5,
      "league_name": "Serie A",
      "season": "2025/2026",
      "matches": 23,
      "minutes": 1479,
      "label": "Serie A 2025/2026"
    }
  ]
}

# Get Odsonne Édouard's seasons
GET /api/players/14165/seasons

# Response:
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
```

---

## Implementation

### Python Backend (FastAPI/Flask)

```python
from pipeline.db import DB
from pipeline.queries import get_player_seasons

# FastAPI
@app.get("/api/players/{player_id}/seasons")
def get_player_seasons_endpoint(player_id: int):
    db = DB()
    try:
        seasons = get_player_seasons(db, player_id)
        return {
            "player_id": player_id,
            "seasons": [
                {
                    "league_id": s["league_id"],
                    "league_name": s["league_name"],
                    "season": s["season"],
                    "matches": s["matches"],
                    "minutes": s["minutes"],
                    "label": f"{s['league_name']} {s['season']}"
                }
                for s in seasons
            ]
        }
    finally:
        db.close()

# Flask
@app.route("/api/players/<int:player_id>/seasons")
def get_player_seasons_endpoint(player_id):
    db = DB()
    try:
        seasons = get_player_seasons(db, player_id)
        return jsonify({
            "player_id": player_id,
            "seasons": [
                {
                    "league_id": s["league_id"],
                    "league_name": s["league_name"],
                    "season": s["season"],
                    "matches": s["matches"],
                    "minutes": s["minutes"],
                    "label": f"{s['league_name']} {s['season']}"
                }
                for s in seasons
            ]
        })
    finally:
        db.close()
```

### React Frontend

```jsx
function PlayerProfile({ playerId }) {
  const [seasons, setSeasons] = useState([]);
  const [selectedSeason, setSelectedSeason] = useState(null);
  const [profile, setProfile] = useState(null);
  
  // 1. Load seasons for THIS player
  useEffect(() => {
    fetch(`/api/players/${playerId}/seasons`)
      .then(r => r.json())
      .then(data => {
        setSeasons(data.seasons);
        // Auto-select most recent season
        if (data.seasons.length > 0) {
          const first = data.seasons[0];
          handleSeasonChange(`${first.league_id}|${first.season}`);
        }
      });
  }, [playerId]);
  
  // 2. Load profile when season changes
  useEffect(() => {
    if (selectedSeason) {
      const [league_id, season] = selectedSeason.split('|');
      fetch(`/api/players/${playerId}?league_id=${league_id}&season=${season}`)
        .then(r => r.json())
        .then(data => setProfile(data));
    }
  }, [playerId, selectedSeason]);
  
  // 3. Handle season change
  const handleSeasonChange = (value) => {
    setSelectedSeason(value);
  };
  
  return (
    <div className="player-profile">
      {/* Header */}
      <h1>{profile?.player.name}</h1>
      <p className="position">{profile?.player.position}</p>
      
      {/* Season Filter - Shows "Ligue 1 2025/2026", not just "2025/2026" */}
      <div className="season-filter">
        <label>Season:</label>
        <select 
          value={selectedSeason || ''} 
          onChange={e => handleSeasonChange(e.target.value)}
        >
          {seasons.map(s => (
            <option 
              key={`${s.league_id}-${s.season}`}
              value={`${s.league_id}|${s.season}`}
            >
              {s.label}
              {s.matches > 1 && ` (${s.matches} matches)`}
            </option>
          ))}
        </select>
      </div>
      
      {/* Context Banner */}
      <div className="context-banner">
        <span className="team">{profile?.player.team}</span>
        <span className="separator">•</span>
        <span className="league">{profile?.player.league}</span>
        <span className="separator">•</span>
        <span className="season">{profile?.player.season}</span>
      </div>
      
      {/* Stats */}
      <div className="stats-grid">
        <div className="stat">
          <label>Matches</label>
          <value>{profile?.stats.matches}</value>
        </div>
        <div className="stat">
          <label>Minutes</label>
          <value>{profile?.stats.minutes}</value>
        </div>
        <div className="stat">
          <label>Overall</label>
          <value>{profile?.percentiles.overall}%</value>
        </div>
        <div className="stat">
          <label>Finishing</label>
          <value>{profile?.percentiles.finishing}%</value>
        </div>
      </div>
      
      {/* Season History */}
      <div className="season-history">
        <h3>Season History</h3>
        {profile?.season_history.map((h, i) => (
          <div key={i} className="history-item">
            <span className="season">{h.season}</span>
            <span className="league">{h.league}</span>
            <span className="team">{h.team}</span>
            <span className="matches">{h.matches} matches</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

## Key Differences from Leaderboard

### Leaderboard Page
- Uses `/api/seasons` - all season+league combinations
- User selects **league first, then season**
- Filters: `league_id=X, season=Y, position=ST`

### Player Profile Page
- Uses `/api/players/{id}/seasons` - only this player's seasons
- Dropdown shows **"Ligue 1 2025/2026"** not just **"2025/2026"**
- Filters: `player_id=X, league_id=Y, season=Z`

---

## Example Flow

**User visits Marcus Thuram profile:**

1. Load `/api/players/15491/seasons`
   - Returns: `[{league_id: 5, league_name: "Serie A", season: "2025/2026", ...}]`

2. Dropdown shows:
   ```
   Serie A 2025/2026 (23 matches)
   ```

3. Auto-select first option
   - Calls `/api/players/15491?league_id=5&season=2025/2026`

4. Profile displays:
   - Name: Marcus Thuram
   - Team: Inter
   - League: Serie A
   - Season: 2025/2026
   - Stats: 23 matches, 1479 mins
   - Overall: 90th percentile

**User visits Odsonne Édouard profile:**

1. Load `/api/players/14165/seasons`
   - Returns: 
     - `{league_id: 4, league_name: "Ligue 1", season: "2025/2026", ...}`
     - `{league_id: 1, league_name: "Premier League", season: "2025/2026", ...}`
     - `{league_id: 1, league_name: "Premier League", season: "2024/2025", ...}`

2. Dropdown shows:
   ```
   Ligue 1 2025/2026 (23 matches)
   Premier League 2025/2026 (1 match)
   Premier League 2024/2025 (6 matches)
   ```

3. User can click each to see his stats in that specific context

---

## Testing

```bash
# Test the endpoint
curl http://localhost:8000/api/players/15491/seasons
curl http://localhost:8000/api/players/14165/seasons

# Use in Python
from pipeline.db import DB
from pipeline.queries import get_player_seasons

db = DB()
seasons = get_player_seasons(db, player_id=14165)
for s in seasons:
    print(f"{s['league_name']} {s['season']}: {s['matches']} matches")
```

---

## Summary

✅ **Problem**: Season filter showed "2024/2025" and "2025/2026" without league context  
✅ **Solution**: New endpoint `/api/players/{id}/seasons` returns `"Ligue 1 2025/2026"`  
✅ **Result**: Users can clearly see which league context they're viewing  
✅ **Benefit**: Handles multi-club, multi-league players correctly