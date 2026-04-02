# Know Ball: League + Season Scoped Data Model

## Overview

Player ratings and statistics in Know Ball are scoped to **(league, season)** combinations. This handles multi-club players, transfers, and cross-league comparisons correctly.

## Data Model

### Core Tables

**`peer_ratings`** - Player ratings per league+season
```sql
UNIQUE(player_id, league_id, season)
```

Each player can have multiple entries:
- One rating per (player, league, season)
- Example: Player in Premier League 2024/2025 + Ligue 1 2025/2026

**`match_player_stats`** - Match-by-match statistics
```sql
- player_id
- match_id (includes league_id and season via match table)
- team_id
- minutes_played, goals, etc.
```

**`players.current_team_id`** - Most recent team globally
- Points to team from player's last match across ALL seasons
- Used for default display and quick links
- NOT season-specific

---

## UI Filter Pattern

### Recommended UI Design

```
┌─────────────────────────────────────┐
│ League: [Premier League ▼]         │
│ Season: [2025/2026 ▼]              │
│ Position: [ST ▼]                   │
│                                     │
│ [Show Leaderboard]                  │
└─────────────────────────────────────┘
```

### Query Examples

#### 1. Get Available Seasons
```python
from pipeline.queries import get_available_seasons

seasons = get_available_seasons(db)
# Returns: [
#   {'league_id': 47, 'league_name': 'Premier League', 'season': '2025/2026'},
#   {'league_id': 53, 'league_name': 'Ligue 1', 'season': '2025/2026'},
#   ...
# ]
```

#### 2. Get Player Profile for Specific League+Season
```python
from pipeline.queries import get_player_profile

# Odsonne Édouard in Ligue 1 2025/2026
profile = get_player_profile(db, player_id=14165, league_id=53, season="2025/2026")

# Returns:
# {
#   'player_name': 'Odsonne Édouard',
#   'team_name': 'RC Lens',
#   'matches_played': 23,
#   'minutes_played': 1475,
#   'overall_percentile': 68,
#   'finishing_percentile': 79,
#   ...
# }
```

#### 3. Get Leaderboard
```python
from pipeline.queries import get_leaderboard

# Top ST in Ligue 1 2025/2026
leaders = get_leaderboard(db, league_id=53, season="2025/2026", position="ST")

# Returns: [
#   {'player_name': 'Marcus Thuram', 'team_name': 'Inter', 'overall_percentile': 85},
#   {'player_name': 'Wissam Ben Yedder', 'team_name': 'Monaco', 'overall_percentile': 82},
#   ...
# ]
```

#### 4. Get Player's Teams by Season
```python
from pipeline.queries import get_player_teams_by_season

# All teams Édouard played for
teams = get_player_teams_by_season(db, player_id=14165)

# Returns: [
#   {'season': '2025/2026', 'league_name': 'Ligue 1', 'team_name': 'RC Lens', 'matches': 23},
#   {'season': '2025/2026', 'league_name': 'Premier League', 'team_name': 'Crystal Palace', 'matches': 1},
#   ...
# ]
```

---

## Edge Cases Handled

### Multi-Club Players (Same League, Same Season)

**Example**: Player transfers mid-season within same league
```
Marcus Thuram - Serie A 2025/2026:
  - Inter: 23 matches (all matches in Serie A)
  - peer_ratings: 1 entry vs Serie A players ✓
```

**UI Display**:
- Show primary team (most matches in that league+season)
- Optionally show secondary teams with match counts

**Query**:
```sql
SELECT team_name, matches, minutes
FROM player_teams_by_season
WHERE player_id = X AND league_id = Y AND season = Z
ORDER BY matches DESC;
```

### Transfers Between Leagues

**Example**: Player moves from PL to Ligue 1
```
Odsonne Édouard:
  - Crystal Palace (Premier League 2025/2026): 1 match, 8 mins
  - RC Lens (Ligue 1 2025/2026): 23 matches, 1475 mins
  
peer_ratings:
  - Premier League 2025/2026: NO ENTRY (< 300 mins)
  - Ligue 1 2025/2026: ENTRY (23 matches, 1475 mins)
```

**UI Behavior**:
- Filter: Premier League 2025/2026 → Player doesn't appear (below minimum)
- Filter: Ligue 1 2025/2026 → Shows RC Lens, rated vs Ligue 1 STs

### Minimum Minutes Threshold

**Current**: `MIN_MINUTES = 300` (defined in `compute.py`)

Players with < 300 mins in a league+season:
- No entry in `peer_ratings`
- Excluded from leaderboards
- Still visible in player search with stats

---

## SQL Views (Pre-created)

### `player_league_season_profile`
Player ratings with team context for specific league+season.

```sql
SELECT * FROM player_league_season_profile
WHERE league_id = 53 AND season = '2025/2026';
```

### `league_season_leaderboard`
Leaderboard for specific league+season+position.

```sql
SELECT * FROM league_season_leaderboard
WHERE league_id = 53 AND season = '2025/2026' AND position = 'ST'
ORDER BY overall_percentile DESC;
```

### `player_teams_by_season`
All teams a player appeared for in each league+season.

```sql
SELECT * FROM player_teams_by_season WHERE player_id = 14165;
```

### `available_seasons`
Available (league, season) combinations with counts.

```sql
SELECT * FROM available_seasons ORDER BY season DESC;
```

---

## Player Profile Page Design

### Header Section
```
┌────────────────────────────────────────┐
│ Marcus Thuram                          │
│ Position: ST | Team: Inter             │ ← From current_team_id
│ Nationality: France                    │
├────────────────────────────────────────┤
│ Filter: [Serie A ▼] [2025/2026 ▼]      │
├────────────────────────────────────────┤
│ Season Stats (Inter):                  │
│   Matches: 23 | Minutes: 1475          │
│   Goals: 11 | Assists: 3               │
│                                        │
│ Percentile Rankings:                   │
│   Overall: 85th | Finishing: 79th      │
│   Involvement: 88th | Physical: 72nd   │
└────────────────────────────────────────┘
```

### Season History Tab
```
┌────────────────────────────────────────┐
│ Season History                          │
├────────────────────────────────────────┤
│ Ligue 1 2023/2024 - RC Lens (12 apps) │
│ Premier League 2023/2024 - ...         │
│ ...                                    │
└────────────────────────────────────────┘
```

---

## Implementation Notes

### 1. Always Filter by League+Season

**Wrong**:
```python
# Don't use current_team_id for ratings
player = get_player(db, player_id)
ratings = get_ratings(db, player.current_team_id)  # ❌
```

**Correct**:
```python
# Derive team from match_player_stats in context
profile = get_player_profile(db, player_id, league_id, season)  # ✓
team = profile['team_name']  # Team in that specific league+season
```

### 2. Use Views for Common Queries

The SQL views are pre-optimized and include team derivation logic:
```python
# Don't join tables manually
players = db.query("""
    SELECT p.*, t.name FROM players p JOIN teams t ...  # ❌
""")

# Use the view
players = get_leaderboard(db, league_id, season, position)  # ✓
```

### 3. Handle Missing Ratings Gracefully

```python
profile = get_player_profile(db, player_id, league_id, season)
if not profile:
    # Player exists but below minimum minutes threshold
    # Show stats but no percentiles
    stats = get_player_teams_by_season(db, player_id, season)
    # Display stats without percentile rankings
```

---

## Migration & Data Flow

### Daily Pipeline

1. **Scrape** (`pipeline/scrape.py`):
   - Fetches new matches and player stats
   - Updates `match_player_stats` per match
   - Updates `players.current_team_id` to most recent team

2. **Rate** (`pipeline/rate.py`):
   - Calculates match ratings for each player

3. **Compute** (`pipeline/compute.py`):
   - Aggregates stats per (player, league, season)
   - Computes percentile rankings vs position peers
   - Populates `peer_ratings` table

4. **Views** (auto-updated):
   - Views read from `peer_ratings` + derived team context
   - Always reflect latest data after compute

---

## Testing

Test queries are in `pipeline/queries.py`:

```bash
python3 -m pipeline.queries
```

Expected output:
```
=== Available Seasons ===
  Bundesliga 2025/2026: 243 matches, 484 players
  La Liga 2025/2026: 290 matches, 566 players
  ...

=== Player Profile (Édouard in Ligue 1 2025/2026) ===
  Odsonne Édouard (RC Lens)
  Matches: 23, Minutes: 1475
  Overall: 68%, Finishing: 79%

=== Édouard's Teams by Season ===
  2025/2026 Ligue 1: RC Lens (23 matches)
  2025/2026 Premier League: Crystal Palace (1 matches)
  ...
```

---

## Future Enhancements

### Optional: Season-Specific Team Tracking

If needed, add a table:

```sql
CREATE TABLE player_season_teams (
    player_id INT REFERENCES players(id),
    season TEXT NOT NULL,
    team_id INT REFERENCES teams(id),
    league_id INT REFERENCES leagues(id),
    matches INT,
    PRIMARY KEY (player_id, season, team_id)
);
```

Populate from `match_player_stats`:
```sql
INSERT INTO player_season_teams
SELECT 
    player_id, season, team_id, league_id, COUNT(*)
FROM match_player_stats mps
JOIN matches m ON m.id = mps.match_id
GROUP BY player_id, season, team_id, league_id;
```

**However**, the current design using `player_teams_by_season` view is simpler and sufficient.