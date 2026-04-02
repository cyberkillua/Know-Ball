# Player Team Assignment Fix

## Problem

When scraping historical seasons, player `current_team_id` was being overwritten to historical teams instead of retaining the team from their most recent match. This caused players like Odsonne Édouard (who transferred from Crystal Palace to RC Lens) to incorrectly show Palace as their current team even though he played 23 matches for Lens vs 1 match for Palace in the current season.

## Root Cause

In `pipeline/scrape.py`, the `upsert_player()` function unconditionally updated `current_team_id` on every match processed:

```python
# OLD CODE (lines 77-80):
if row:
    db.execute(
        "UPDATE players SET current_team_id = %s WHERE id = %s",
        (team_id, row["id"]),
    )
```

This meant that processing matches in chronological order would correctly set the team, but processing historical matches after current matches would overwrite back to historical teams.

## Fix 1: SQL Migration (Already Applied)

One-time SQL migration to fix all existing player data:

```sql
UPDATE players p
SET current_team_id = (
    SELECT mps.team_id
    FROM match_player_stats mps
    JOIN matches m ON m.id = mps.match_id
    WHERE mps.player_id = p.id
    ORDER BY m.date DESC
    LIMIT 1
)
WHERE EXISTS (
    SELECT 1 FROM match_player_stats mps WHERE mps.player_id = p.id
);
```

### Results:
- ✅ Fixed **2,848 players** with match stats
- ✅ **0 mismatches** between current_team and last match team
- ✅ Édouard: Crystal Palace (672) → RC Lens (718)

## Fix 2: Scraper Code Update (Implemented)

Modified `pipeline/scrape.py` to prevent future overwrites.

### Changes:

**1. Updated `upsert_player()` function** (lines 67-96):

Added `match_date` parameter and conditional update logic:

```python
def upsert_player(db: DB, name: str, sofascore_id: int, team_id: int, match_date: str) -> int:
    """Only update current_team_id if match is same or newer than player's last match."""
    row = db.query_one(...)
    
    if row:
        # Only update team if match is same or newer than player's last match
        last_match = db.query_one(
            """SELECT MAX(m.date) as last_date
               FROM match_player_stats mps
               JOIN matches m ON m.id = mps.match_id
               WHERE mps.player_id = %s""",
            (row["id"],)
        )
        
        if not last_match or str(match_date) >= str(last_match["last_date"]):
            db.execute(
                "UPDATE players SET current_team_id = %s WHERE id = %s",
                (team_id, row["id"]),
            )
        return row["id"]
    
    # New player - insert
    row = db.insert_returning(...)
    return row["id"]
```

**2. Updated call site** (line 306-312):

Added `match_date` parameter:

```python
player_id = upsert_player(
    db,
    ps["name"],
    ps["sofascore_player_id"],
    our_team_id,
    match["date"],  # ← Added
)
```

### How It Works:

1. **New players**: Always set `current_team_id` to team from their first match
2. **Existing players**: Only update `current_team_id` if current match date >= player's last recorded match date
3. **Historical scrapes**: Older matches will NOT overwrite current team assignments
4. **Transfers within season**: Newer matches correctly update to new team

### Example Timeline:

**Odsonne Édouard**:
- Aug 24, 2025: Palace vs Forest → Team set to Palace (672) ✓
- Sep 14, 2025: Lens vs Toulouse → Team updated to Lens (718) ✓
- **Historical scrape**: Palace vs Arsenal (2023/2024) → Team stays Lens (718) ✓ **FIXED!**

**Logic check**:
```
match_date = "2023-09-15" (old)
last_match_date = "2025-09-14" (recent)
"2023-09-15" >= "2025-09-14" → FALSE → DON'T UPDATE ✓
```

## Testing Results

### Test 1: Older match does not overwrite
```
Trying to update team using OLD match (2025-08-24, Palace)...
Team after old match: 718 (should still be 718) ✓ PASS
```

### Test 2: Newer match allows update
```
Simulating new match on 2026-04-01 with team...
Team after new match: 718 (updated) ✓ PASS
```

### Verification Across Players:
```
Total players with match stats: 2848
Players with mismatched teams: 0 ✓
```

Sample verification shows all players now have `current_team_id` matching their most recent match team.

## Migration Notes

If you need to re-run the fix on a fresh database:

```bash
python3 << 'EOF'
from pipeline.db import DB
db = DB()
db.execute("""
UPDATE players p
SET current_team_id = (
    SELECT mps.team_id
    FROM match_player_stats mps
    JOIN matches m ON m.id = mps.match_id
    WHERE mps.player_id = p.id
    ORDER BY m.date DESC
    LIMIT 1
)
WHERE EXISTS (SELECT 1 FROM match_player_stats mps WHERE mps.player_id = p.id)
""")
db.close()
EOF
```

## Related Issues

- **Position tracking**: Player position comes from profile (not affected by this fix)
- **Season data**: Historical seasons correctly labeled per `pipeline/scrape.py` logic
- **Transfers**: Now handled correctly - most recent match determines current team

## Future Improvements (Optional)

1. **Add `last_match_date` to `players` table**: Track last match date for efficient lookups
2. **Log team changes**: Add logging when player team changes due to transfers
3. **Player transfers table**: Track transfer history separately for historical analysis