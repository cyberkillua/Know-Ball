import { useState } from 'react'
import type { Shot } from '../../lib/types'

// SVG canvas
const W = 300
const H = 420
const PAD = 16
const UW = W - 2 * PAD // 268 — usable width  (maps pitch y: 0→1)
const UH = H - 2 * PAD // 388 — usable height (maps pitch x: 0.5→1.0)

// Convert pitch coordinates to SVG coordinates.
// Pitch: x=1 is goal line (top in SVG), x=0.5 is halfway line (bottom).
//        y=0 is one touchline (left), y=1 is other touchline (right).
function toSvg(pitchX: number, pitchY: number) {
  const sx = pitchY * UW + PAD
  const sy = (1 - pitchX) * 2 * UH + PAD
  return { x: sx, y: sy }
}

// Penalty area: depth 16.5m/105m ≈ 0.157 → pitchX ≥ 0.843
//               width 40.32m/68m ≈ 0.593 → pitchY ∈ [0.203, 0.797]
const PA_LEFT = toSvg(0.843, 0.203)
const PA_RIGHT = toSvg(0.843, 0.797)
const PA_DEPTH = toSvg(0.843, 0.5).y  // bottom of penalty area in SVG

// Six-yard box: depth 5.5m/105m ≈ 0.052 → pitchX ≥ 0.948
//               width 18.32m/68m ≈ 0.269 → pitchY ∈ [0.365, 0.635]
const SY_LEFT = toSvg(0.948, 0.365)
const SY_RIGHT = toSvg(0.948, 0.635)
const SY_DEPTH = toSvg(0.948, 0.5).y

// Goal: 7.32m/68m ≈ 0.108 → pitchY ∈ [0.446, 0.554]
const GOAL_LEFT = toSvg(1, 0.446)
const GOAL_RIGHT = toSvg(1, 0.554)

// Penalty spot: 11m/105m ≈ 0.105 from goal → pitchX = 0.895
const PENALTY_SPOT = toSvg(0.895, 0.5)

const RESULT_COLORS: Record<string, string> = {
  Goal: '#22c55e',
  SavedShot: '#f59e0b',
  MissedShots: '#ef4444',
  BlockedShot: '#6b7280',
  ShotOnPost: '#f97316',
}

function shotColor(result: string) {
  return RESULT_COLORS[result] ?? '#6b7280'
}

function shotRadius(xg: number) {
  return Math.max(4, Math.min(14, xg * 40 + 4))
}

export default function PitchShotMap({ shots }: { shots: Shot[] }) {
  const [hovered, setHovered] = useState<Shot | null>(null)

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full rounded-lg"
        style={{ maxHeight: 480, background: '#0f2318' }}
      >
        {/* Pitch outline */}
        <rect x={PAD} y={PAD} width={UW} height={UH} fill="none" stroke="#1e4d2e" strokeWidth={1.5} />

        {/* Penalty area */}
        <rect
          x={PA_LEFT.x}
          y={PAD}
          width={PA_RIGHT.x - PA_LEFT.x}
          height={PA_DEPTH - PAD}
          fill="none"
          stroke="#1e4d2e"
          strokeWidth={1.5}
        />

        {/* Six-yard box */}
        <rect
          x={SY_LEFT.x}
          y={PAD}
          width={SY_RIGHT.x - SY_LEFT.x}
          height={SY_DEPTH - PAD}
          fill="none"
          stroke="#1e4d2e"
          strokeWidth={1.5}
        />

        {/* Goal */}
        <rect
          x={GOAL_LEFT.x}
          y={PAD - 10}
          width={GOAL_RIGHT.x - GOAL_LEFT.x}
          height={10}
          fill="#1e4d2e"
          stroke="#1e4d2e"
          strokeWidth={1}
        />

        {/* Penalty spot */}
        <circle cx={PENALTY_SPOT.x} cy={PENALTY_SPOT.y} r={2} fill="#1e4d2e" />

        {/* Halfway line label */}
        <text x={W / 2} y={H - 4} textAnchor="middle" fontSize={9} fill="#1e4d2e">
          Halfway line
        </text>

        {/* Shot dots */}
        {shots.map((shot) => {
          const { x, y } = toSvg(shot.x, shot.y)
          return (
            <circle
              key={shot.id}
              cx={x}
              cy={y}
              r={shotRadius(shot.xg)}
              fill={shotColor(shot.result)}
              fillOpacity={0.85}
              stroke={hovered?.id === shot.id ? '#fff' : 'rgba(0,0,0,0.3)'}
              strokeWidth={hovered?.id === shot.id ? 2 : 1}
              className="cursor-pointer transition-opacity"
              onMouseEnter={() => setHovered(shot)}
              onMouseLeave={() => setHovered(null)}
            />
          )
        })}
      </svg>

      {/* Tooltip */}
      {hovered && (
        <div className="pointer-events-none absolute left-1/2 top-2 z-10 -translate-x-1/2 rounded-md border border-border bg-card px-3 py-2 text-xs shadow-lg">
          <div className="font-medium">
            {hovered.minute}&apos; — {hovered.result}
          </div>
          <div className="text-muted-foreground">
            xG: {Number(hovered.xg).toFixed(3)}
            {hovered.body_part ? ` · ${hovered.body_part}` : ''}
            {hovered.situation ? ` · ${hovered.situation}` : ''}
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        {Object.entries(RESULT_COLORS).map(([label, color]) => (
          <div key={label} className="flex items-center gap-1.5">
            <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
            <span>{label === 'MissedShots' ? 'Missed' : label === 'SavedShot' ? 'Saved' : label === 'BlockedShot' ? 'Blocked' : label === 'ShotOnPost' ? 'Post' : label}</span>
          </div>
        ))}
        <span className="ml-auto">Dot size = xG</span>
      </div>
    </div>
  )
}
