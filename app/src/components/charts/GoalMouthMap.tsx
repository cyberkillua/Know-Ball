import { useState } from 'react'
import type { Shot } from '../../lib/types'

// Goal frame SVG dimensions
const W = 300
const H = 140
const PAD_X = 24
const PAD_Y = 20

// Usable area inside SVG for the goal frame
const GW = W - 2 * PAD_X  // 252px wide
const GH = H - 2 * PAD_Y  // 100px tall  → maps goal_mouth_z 0→1 (z=0 is ground)

// Sofascore goal_mouth_y is in pitch coords (0–1 = full pitch width ~68m).
// Standard goal: 7.32m wide → posts at ~44.62% and ~55.38% of pitch width.
const GOAL_Y_MIN = 0.4462  // left post in pitch coords
const GOAL_Y_MAX = 0.5538  // right post in pitch coords

// Convert goal_mouth coords to SVG. z=0=ground → bottom of frame, z=1=bar → top.
function toSvg(gy: number, gz: number) {
  const normalizedY = (gy - GOAL_Y_MIN) / (GOAL_Y_MAX - GOAL_Y_MIN)
  return {
    x: normalizedY * GW + PAD_X,
    y: (1 - gz) * GH + PAD_Y,
  }
}

const RESULT_COLORS: Record<string, string> = {
  Goal: '#22c55e',
  SavedShot: '#f59e0b',
  ShotOnPost: '#f97316',
}

function shotColor(result: string) {
  return RESULT_COLORS[result] ?? '#6b7280'
}

function shotRadius(xg: number) {
  return Math.max(4, Math.min(12, Number(xg) * 35 + 4))
}

// Only show goal, saved, on-post (shots with meaningful goal_mouth data)
const RELEVANT = new Set(['Goal', 'SavedShot', 'ShotOnPost'])

export default function GoalMouthMap({ shots }: { shots: Shot[] }) {
  const [hovered, setHovered] = useState<Shot | null>(null)

  const relevant = shots.filter(
    (s) => RELEVANT.has(s.result) && s.goal_mouth_y != null && s.goal_mouth_z != null,
  )

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full rounded-lg"
        style={{ background: '#111827' }}
      >
        {/* Goal frame */}
        {/* Left post */}
        <line x1={PAD_X} y1={PAD_Y} x2={PAD_X} y2={PAD_Y + GH} stroke="#4b5563" strokeWidth={3} strokeLinecap="round" />
        {/* Right post */}
        <line x1={PAD_X + GW} y1={PAD_Y} x2={PAD_X + GW} y2={PAD_Y + GH} stroke="#4b5563" strokeWidth={3} strokeLinecap="round" />
        {/* Crossbar */}
        <line x1={PAD_X} y1={PAD_Y} x2={PAD_X + GW} y2={PAD_Y} stroke="#4b5563" strokeWidth={3} strokeLinecap="round" />
        {/* Ground line */}
        <line x1={PAD_X - 8} y1={PAD_Y + GH} x2={PAD_X + GW + 8} y2={PAD_Y + GH} stroke="#374151" strokeWidth={1.5} />

        {/* Grid lines (3×2 zones) */}
        {/* Vertical thirds */}
        <line x1={PAD_X + GW / 3} y1={PAD_Y} x2={PAD_X + GW / 3} y2={PAD_Y + GH} stroke="#1f2937" strokeWidth={1} strokeDasharray="3,3" />
        <line x1={PAD_X + (GW * 2) / 3} y1={PAD_Y} x2={PAD_X + (GW * 2) / 3} y2={PAD_Y + GH} stroke="#1f2937" strokeWidth={1} strokeDasharray="3,3" />
        {/* Horizontal half */}
        <line x1={PAD_X} y1={PAD_Y + GH / 2} x2={PAD_X + GW} y2={PAD_Y + GH / 2} stroke="#1f2937" strokeWidth={1} strokeDasharray="3,3" />

        {/* Shot dots */}
        {relevant.map((shot) => {
          const { x, y } = toSvg(shot.goal_mouth_y!, shot.goal_mouth_z!)
          return (
            <circle
              key={shot.id}
              cx={x}
              cy={y}
              r={shotRadius(shot.xg)}
              fill={shotColor(shot.result)}
              fillOpacity={0.85}
              stroke={hovered?.id === shot.id ? '#fff' : 'rgba(0,0,0,0.4)'}
              strokeWidth={hovered?.id === shot.id ? 2 : 1}
              className="cursor-pointer"
              onMouseEnter={() => setHovered(shot)}
              onMouseLeave={() => setHovered(null)}
            />
          )
        })}
      </svg>

      {hovered && (
        <div className="pointer-events-none absolute left-1/2 top-1 z-10 -translate-x-1/2 rounded-md border border-border bg-card px-3 py-2 text-xs shadow-lg">
          <div className="font-medium">
            {hovered.minute}&apos; — {hovered.result}
          </div>
          <div className="text-muted-foreground">
            xG: {Number(hovered.xg).toFixed(3)}
            {hovered.body_part ? ` · ${hovered.body_part}` : ''}
          </div>
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        {Object.entries(RESULT_COLORS).map(([label, color]) => (
          <div key={label} className="flex items-center gap-1.5">
            <div className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
            <span>{label === 'SavedShot' ? 'Saved' : label === 'ShotOnPost' ? 'Post' : label}</span>
          </div>
        ))}
        <span className="ml-auto text-[10px]">{relevant.length} shots shown</span>
      </div>
    </div>
  )
}
