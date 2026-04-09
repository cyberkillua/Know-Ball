# Full Pitch, Single Direction, Mirrored Defensive Shots

## Problem
The current full-pitch rendering has goal markings on both ends, making it look like a real match with two teams attacking in opposite directions. For a player shot map, ALL shots should face ONE direction (toward the opponent's goal). Additionally, defensive-half shots need y-coordinate mirroring so that wing consistency is maintained (e.g., a right-winger's shots from both halves appear on the same side).

## Changes to `PitchShotMap.tsx`

### 1. Add `transformShot()` function
```typescript
function transformShot(rawX: number, rawY: number) {
  const px = normalizeX(rawX)
  const py = px < 0.5 ? 1 - rawY : rawY  // mirror y for defensive-half shots
  return { px, py }
}
```
This mirrors the y-coordinate for shots in the defensive half (`px < 0.5`) so that wing-side is consistent across the entire pitch.

### 2. Use `transformShot()` everywhere shots are processed
Replace all `normalizeX(s.x)` + `s.y` usage with `transformShot(s.x, s.y)` in:
- `grid` and `maxCount` useMemo (heat grid computation)
- `zoneStats` useMemo (per-zone statistics)
- `goalPositions` useMemo (goal marker positions)

### 3. Remove left-side goal markings
Delete from the SVG:
- Left penalty area (`lPaTl`, `lPaBr`, left PA rect)
- Left six-yard box (`lSyTl`, `lSyBr`, left SY rect)
- Left goal (`lGoalTl`, `lGoalBr`, left goal rect)
- Left penalty spot circle
- Left penalty arc (`leftPenArc`)
- Left-side constants (`LX_PA`, `LX_SY`, `L_PEN_X`)

Keep only RIGHT-side: right PA, right SY, right goal, right penalty spot, right penalty arc.

### 4. Add half labels
Add two small muted SVG text labels:
- "Own half" centered on the left side
- "Attacking half" centered on the right side

### 5. Keep reference pitch elements
- Pitch outline rect
- Halfway line
- Center circle
- Center spot
- All four corner arcs
- Right penalty area, six-yard box, goal, penalty spot, penalty arc (all clipped)

### 6. Clean up unused constants
Remove:
- `LX_PA`, `LX_SY`, `L_PEN_X`
- `lPaTl`, `lPaBr`, `lSyTl`, `lSyBr`, `lGoalTl`, `lGoalBr`
- `leftPenArc`