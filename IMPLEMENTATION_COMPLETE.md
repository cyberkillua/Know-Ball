# Implementation Complete: League+Season Scoped Data Model

## Summary

Successfully implemented a complete league+season scoped data access layer for Know Ball. All queries and ratings are now properly scoped to (player, league, season) combinations, correctly handling multi-club players and transfers.

---

## What Was Implemented

### 1. SQL Views (Migration 012)

Created 4 database views for efficient queries:

**`player_league_season_profile`**
- Player ratings + team context for specific league+season
- One row per player per league+season

**`league_season_leaderboard`**
- Ordered leaderboard for league+season+position
- Includes team and all key metrics

**`player_teams_by_season`**
- All teams a player appeared for in each league+season
- Useful for showing multi-club history

**`available_seasons`**
- Lists all available (league, season) combinations
- Includes match and player counts for UI dropdowns

**File**: `supabase/migrations/012_league_season_views.sql`

---

### 2. Python Query Helpers

Created `pipeline/queries.py` with helper functions:

```python
# Get available seasons for dropdowns
seasons = get_available_seasons(db)

# Get player profile for specific league+season
profile = get_player_profile(db, player_id, league_id, season)

# Get leaderboard
leaders = get_leaderboard(db, league_id, season, position, limit=100)

# Get player's teams across all seasons
teams = get_player_teams_by_season(db, player_id)

# Search players
results = search_players(db, name="Thuram", limit=10)
```

**File**: `pipeline/queries.py`

---

### 3. Example Code

Created comprehensive examples showing:

- How to populate season dropdowns
- How to display player profiles
- How to generate leaderboards
- How to handle multi-club players
- How to use search with context

**File**: `examples/ui_queries.py`

**Run**: `python3 examples/ui_queries.py`

---

### 4. Documentation

Created detailed documentation covering:

- Data model explanation
- UI filter design pattern
- Query examples
- Edge cases handled
- Migration notes

**File**: `DATA_MODEL.md`

---

## Key Design Decisions

### 1. League+Season Scope for Ratings

**Rationale**: Ratings should be compared within context of league and season.

**Implementation**:
```sql
peer_ratings UNIQUE(player_id, league_id, season)
```

**Benefits**:
- ✅ Multi-club players handled correctly
- ✅ Transfers between leagues = separate ratings
- ✅ Fair comparisons within same competition

---

### 2. Team Derived from Match Data

**Rationale**: Player's team should be derived from actual match data for the specific league+season context.

**Implementation**:
```sql
-- Team for player in specific context
SELECT team_name FROM player_teams_by_season
WHERE player_id = X AND league_id = Y AND season = Z
ORDER BY matches DESC LIMIT 1;
```

**Benefits**:
- ✅ Always shows correct team for context
- ✅ Handles mid-season transfers
- ✅ No need for player_season_teams table

---

### 3. Current Team Field Kept

**Rationale**: `players.current_team_id` still useful for defaults and quick links.

**Implementation**:
- Set to most recent team globally (fixed via migration + scraper)
- Used for: player search, default season in UI, autocomplete

**Benefits**:
- ✅ Quick default display
- ✅ Not authoritative for historical seasons
- ✅ UI always derives team from context

---

## League ID Mapping

**Important**: Internal league IDs vs FotMob IDs

| Internal ID | League Name | FotMob ID |
|-------------|-------------|-----------|
| 1 | Premier League | 47 |
| 2 | Championship | 48 |
| 3 | La Liga | 87 |
| 4 | Ligue 1 | 53 |
| 5 | Serie A | 55 |
| 6 | Bundesliga | 54 |

**Use internal ID** for queries, views, and peer_ratings.

---

## Example Queries

### UI Component: Season Dropdown
```python
from pipeline.queries import get_available_seasons

seasons = get_available_seasons(db)
# Returns: [
#   {'league_id': 4, 'league_name': 'Ligue 1', 'season': '2025/2026'},
#   ...
# ]
```

### UI Component: Player Profile
```python
from pipeline.queries import get_player_profile

# Marcus Thuram in Serie A 2025/2026
profile = get_player_profile(db, 
    player_id=15491, 
    league_id=5,    # Internal ID for Serie A
    season="2025/2026"
)

# Returns: {
#   'player_name': 'Marcus Thuram',
#   'team_name': 'Inter',
#   'position': 'ST',
#   'overall_percentile': 90,
#   ...
# }
```

### UI Component: Leaderboard
```python
from pipeline.queries import get_leaderboard

# Top 5 strikers in Ligue 1 2025/2026
leaders = get_leaderboard(db,
    league_id=4,    # Internal ID for Ligue 1
    season="2025/2026",
    position="ST",
    limit=5
)

# Returns: [
#   {'player_name': 'Florian Thauvin', 'team_name': 'RC Lens', 'overall_percentile': 99},
#   {'player_name': 'Danny Namaso', 'team_name': 'Auxerre', 'overall_percentile': 97},
#   ...
# ]
```

---

## Fixes Applied

### 1. Player Team Assignment Bug
- ✅ Fixed scraper to prevent historical overwrites
- ✅ Migrated existing data to most recent team
- ✅ Added match-date-based update logic
- **File**: `pipeline/scrape.py` (lines 67-96)

### 2. Season Label Bug
- ✅ Fixed incorrect "2023/2024" labels → "2025/2026"
- ✅ Applied to matches table
- ✅ Applied to peer_ratings table
- **File**: `PLAYER_TEAM_FIX.md`

---

## Testing Results

### ✅ Ligue 1 2025/2026 ST Leaderboard
```
1. Florian Thauvin (RC Lens) - 99%
2. Danny Namaso (Auxerre) - 97%
3. Ludovic Ajorque (Stade Brestois) - 95%
```

### ✅ Serie A 2025/2026 ST Leaderboard
```
1. Lautaro Martínez (Inter) - 99%
2. Sebastiano Esposito (Cagliari) - 98%
3. Keinan Davis (Udinese) - 96%
```

### ✅ Marcus Thuram (Inter)
- Serie A 2025/2026: 23 matches, 1479 mins
- Overall: 90th percentile
- Finishing: 74th percentile

### ✅ Odsonne Édouard (Multi-Club)
- Ligue 1 2025/2026: RC Lens (23 matches)
- Premier League 2025/2026: Crystal Palace (1 match)
- ✅ Database shows correct teams per league

---

## Data Model Architectural Decisions

### Why Not player_season_teams Table?

**Considered**: Add a table to track team per player per season

**Rejected Because**: 
1. Match data already contains this information
2. Views can derive it efficiently
3. Less duplication
4. No additional maintenance needed

**Using Views Instead**: `player_teams_by_season` view provides same functionality without extra table

### Why Keep current_team_id?

**Considered**: Remove it and always derive from matches

**Kept Because**:
1. Useful for player search dropdown defaults
2. Quick display in autocomplete
3. Not authoritative for historical seasons
4. UI should derive team from context for ratings

---

## Future Enhancements

### Optional: Add team_history Table

If you need to track transfer dates and details:

```sql
CREATE TABLE player_transfers (
    id SERIAL PRIMARY KEY,
    player_id INT REFERENCES players(id),
    from_team_id INT REFERENCES teams(id),
    to_team_id INT REFERENCES teams(id),
    transfer_date DATE,
    transfer_type TEXT,  -- 'loan', 'permanent', 'free'
    season TEXT
);
```

But this is not needed for current functionality.

---

## Files Created

1. `supabase/migrations/012_league_season_views.sql` - SQL views
2. `pipeline/queries.py` - Query helper functions
3. `examples/ui_queries.py` - Usage examples
4. `DATA_MODEL.md` - Comprehensive documentation
5. `PLAYER_TEAM_FIX.md` - Team assignment fix documentation

---

## How to Use

### Backend API Endpoints

Create endpoints using the query helpers:

```python
# FastAPI/Flask example
@app.get("/api/seasons")
def get_seasons():
    return get_available_seasons(db)

@app.get("/api/players/{player_id}/profile")
def get_profile(player_id: int, league_id: int, season: str):
    return get_player_profile(db, player_id, league_id, season)

@app.get("/api/leaderboard")
def get_leaderboard_data(league_id: int, season: str, position: str):
    return get_leaderboard(db, league_id, season, position)
```

### Frontend Implementation

```javascript
// Fetch available seasons
const seasons = await fetch('/api/seasons').then(r => r.json());

// Populate dropdowns
seasons.forEach(s => {
    // Add to league dropdown
    // Add to season dropdown
});

// Fetch player profile
const profile = await fetch(
    `/api/players/${player_id}/profile?league_id=${leagueId}&season=${season}`
).then(r => r.json());
```

---

## ✅ All Components Working

1. ✅ SQL views created and tested
2. ✅ Query helpers implemented
3. ✅ Examples working correctly
4. ✅ Documentation complete
5. ✅ Player team assignment fixed
6. ✅ Season labels corrected
7. ✅ League IDs clarified
8. ✅ Examples demonstrate correct usage

**Status**: Production ready!