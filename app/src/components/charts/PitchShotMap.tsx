import { useState, useMemo } from 'react'
import type { Shot } from '../../lib/types'

const W = 480
const H = 380
const PAD = 20
const UW = W - 2 * PAD
const UH = H - 2 * PAD

const PITCH_LEN = 105
const PITCH_WID = 68

const GRID_ROWS = 6
const GRID_COLS = 6

const X_MIN = 0.5
const X_MAX = 1.0
const Y_MIN = 0.0
const Y_MAX = 1.0

const CELL_H = (X_MAX - X_MIN) / GRID_ROWS
const CELL_W = (Y_MAX - Y_MIN) / GRID_COLS

const RX_PA = 1 - 16.5 / PITCH_LEN
const RX_SY = 1 - 5.5 / PITCH_LEN
const PA_Y_TOP = 0.203
const PA_Y_BOT = 0.797
const SY_Y_TOP = 0.365
const SY_Y_BOT = 0.635
const GOAL_Y_TOP = 0.446
const GOAL_Y_BOT = 0.554
const GOAL_DEPTH = 2.2 / PITCH_LEN
const R_PEN_X = 1 - 11 / PITCH_LEN
const PEN_ARC_R = 9.15
const PEN_ARC_DX = 5.5
const PEN_ARC_HALF_ANGLE = Math.acos(PEN_ARC_DX / PEN_ARC_R)

function toSvg(px: number, py: number) {
  const sx = py * UW + PAD
  const sy = (1 - px) * 2 * UH + PAD
  return { x: sx, y: sy }
}

function normalizeX(rawX: number): number {
  return 1 - rawX
}

function transformShot(rawX: number, rawY: number) {
  const px = normalizeX(rawX)
  if (px < 0.5) {
    return { px: 1 - px, py: rawY }
  }
  return { px, py: rawY }
}

function getZone(pitchX: number, pitchY: number): [number, number] {
  const col = Math.min(Math.floor((pitchY - Y_MIN) / CELL_W), GRID_COLS - 1)
  const row = Math.min(Math.floor((pitchX - X_MIN) / CELL_H), GRID_ROWS - 1)
  return [Math.max(0, row), Math.max(0, col)]
}

function zoneCenter(row: number, col: number) {
  const pitchX = X_MIN + (row + 0.5) * CELL_H
  const pitchY = Y_MIN + (col + 0.5) * CELL_W
  return toSvg(pitchX, pitchY)
}

function zoneRect(row: number, col: number) {
  const pitchX = X_MIN + row * CELL_H
  const pitchY = Y_MIN + col * CELL_W
  const tl = toSvg(pitchX + CELL_H, pitchY)
  const br = toSvg(pitchX, pitchY + CELL_W)
  return {
    x: Math.min(tl.x, br.x),
    y: Math.min(tl.y, br.y),
    w: Math.abs(br.x - tl.x),
    h: Math.abs(br.y - tl.y),
  }
}

function heatColor(count: number, maxCount: number): string {
  if (count === 0) return 'transparent'
  const t = count / maxCount
  const r = Math.round(40 - t * 6)
  const g = Math.round(100 + t * 130)
  const b = Math.round(240 - t * 2)
  const a = (0.1 + t * 0.72).toFixed(2)
  return `rgba(${r},${g},${b},${a})`
}

function arcPath(
  cx: number,
  cy: number,
  rMeters: number,
  startAngle: number,
  endAngle: number,
  steps: number = 24,
): string {
  const rxP = rMeters / PITCH_LEN
  const ryP = rMeters / PITCH_WID
  let d = ''
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const angle = startAngle + (endAngle - startAngle) * t
    const px = cx + rxP * Math.cos(angle)
    const py = cy + ryP * Math.sin(angle)
    const svg = toSvg(px, py)
    d += `${i === 0 ? 'M' : 'L'}${svg.x.toFixed(1)},${svg.y.toFixed(1)} `
  }
  return d
}

const LINE_COLOR = '#1e293b'
const BG_COLOR = '#0f172a'

export default function PitchShotMap({ shots }: { shots: Shot[] }) {
  const [hoveredZone, setHoveredZone] = useState<[number, number] | null>(null)

  const { grid, maxCount } = useMemo(() => {
    const g: number[][] = Array.from({ length: GRID_ROWS }, () =>
      Array(GRID_COLS).fill(0),
    )
    for (const s of shots) {
      const { px, py } = transformShot(s.x, s.y)
      const [row, col] = getZone(px, py)
      if (row >= 0 && row < GRID_ROWS && col >= 0 && col < GRID_COLS) {
        g[row][col]++
      }
    }
    let mx = 0
    for (const r of g) for (const c of r) if (c > mx) mx = c
    return { grid: g, maxCount: mx }
  }, [shots])

  const zoneStats = useMemo(() => {
    const stats: Record<string, { shots: number; goals: number; xg: number }> = {}
    for (const s of shots) {
      const { px, py } = transformShot(s.x, s.y)
      const [row, col] = getZone(px, py)
      const key = `${row},${col}`
      if (!stats[key]) stats[key] = { shots: 0, goals: 0, xg: 0 }
      stats[key].shots++
      if (s.result === 'Goal') stats[key].goals++
      stats[key].xg += Number(s.xg)
    }
    return stats
  }, [shots])

  const goalPositions = useMemo(() => {
    return shots
      .filter((s) => s.result === 'Goal')
      .map((g) => {
        const { px, py } = transformShot(g.x, g.y)
        const pos = toSvg(px, py)
        return { id: g.id, x: pos.x, y: pos.y }
      })
  }, [shots])

  const hoveredKey = hoveredZone ? `${hoveredZone[0]},${hoveredZone[1]}` : null
  const hz = hoveredKey ? zoneStats[hoveredKey] : null

  const paTl = toSvg(1, PA_Y_TOP)
  const paTr = toSvg(1, PA_Y_BOT)
  const paBl = toSvg(RX_PA, PA_Y_TOP)
  const paBr = toSvg(RX_PA, PA_Y_BOT)

  const syTl = toSvg(1, SY_Y_TOP)
  const syTr = toSvg(1, SY_Y_BOT)
  const syBl = toSvg(RX_SY, SY_Y_TOP)
  const syBr = toSvg(RX_SY, SY_Y_BOT)

  const goalBotLeft = toSvg(1, GOAL_Y_TOP)
  const goalBotRight = toSvg(1, GOAL_Y_BOT)
  const goalTopLeft = toSvg(1 + GOAL_DEPTH, GOAL_Y_TOP)
  

  const penSpot = toSvg(R_PEN_X, 0.5)

  const paX = Math.min(paTl.x, paBl.x)
  const paY = Math.min(paTl.y, paBl.y)
  const paW = Math.abs(paTr.x - paBl.x)
  const paH = Math.abs(paBr.y - paTl.y)

  const syX = Math.min(syTl.x, syBl.x)
  const syY = Math.min(syTl.y, syBl.y)
  const syW = Math.abs(syTr.x - syBl.x)
  const syH = Math.abs(syBr.y - syTl.y)

  const rightPenArc = arcPath(
    R_PEN_X,
    0.5,
    PEN_ARC_R,
    Math.PI - PEN_ARC_HALF_ANGLE,
    Math.PI + PEN_ARC_HALF_ANGLE,
  )

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full rounded-lg"
        style={{ maxHeight: 420, background: BG_COLOR }}
      >
        <defs>
          <clipPath id="pitch-clip">
            <rect x={PAD} y={PAD} width={UW} height={UH} />
          </clipPath>
        </defs>

        <rect x={PAD} y={PAD} width={UW} height={UH} fill="none" stroke={LINE_COLOR} strokeWidth={1.5} rx={2} />

        <rect
          x={paX}
          y={paY}
          width={paW}
          height={paH}
          fill="none"
          stroke="#475569"
          strokeWidth={2}
        />

        <rect
          x={syX}
          y={syY}
          width={syW}
          height={syH}
          fill="none"
          stroke="#475569"
          strokeWidth={2}
        />

        <rect
          x={goalBotLeft.x}
          y={goalTopLeft.y}
          width={goalBotRight.x - goalBotLeft.x}
          height={goalBotLeft.y - goalTopLeft.y}
          fill={BG_COLOR}
          stroke={LINE_COLOR}
          strokeWidth={1.5}
          rx={1}
        />

        <circle cx={penSpot.x} cy={penSpot.y} r={1.5} fill={LINE_COLOR} />

        <g clipPath="url(#pitch-clip)">
          <path d={rightPenArc} fill="none" stroke={LINE_COLOR} strokeWidth={1} />
        </g>

        <text x={W / 2} y={H - 6} textAnchor="middle" fontSize={9} fill="#334155" fontWeight={500}>
          Halfway line
        </text>

        {grid.map((row, ri) =>
          row.map((count, ci) => {
            if (count === 0) return null
            const r = zoneRect(ri, ci)
            const fillColor = heatColor(count, maxCount)
            const isHovered = hoveredZone?.[0] === ri && hoveredZone?.[1] === ci
            return (
              <rect
                key={`z-${ri}-${ci}`}
                x={r.x}
                y={r.y}
                width={r.w}
                height={r.h}
                fill={fillColor}
                rx={2}
                stroke={isHovered ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.04)'}
                strokeWidth={isHovered ? 1.5 : 0.5}
                className="cursor-pointer transition-all"
                onMouseEnter={() => setHoveredZone([ri, ci])}
                onMouseLeave={() => setHoveredZone(null)}
              />
            )
          }),
        )}

        {grid.map((row, ri) =>
          row.map((count, ci) => {
            if (count === 0) return null
            const c = zoneCenter(ri, ci)
            const t = count / maxCount
            return (
              <text
                key={`t-${ri}-${ci}`}
                x={c.x}
                y={c.y}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={t > 0.6 ? 11 : 9}
                fontWeight={t > 0.6 ? 700 : 600}
                fill={t > 0.4 ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.55)'}
                className="pointer-events-none"
              >
                {count}
              </text>
            )
          }),
        )}

        {goalPositions.map((g) => (
          <circle
            key={g.id}
            cx={g.x}
            cy={g.y}
            r={4}
            fill="#22c55e"
            fillOpacity={0.9}
            stroke="#fff"
            strokeWidth={1}
            className="pointer-events-none"
          />
        ))}
      </svg>

      {hoveredZone && hz && (
        <div className="pointer-events-none absolute left-1/2 top-2 z-10 -translate-x-1/2 rounded-md border border-border bg-card px-3 py-2 text-xs shadow-lg">
          <div className="font-medium">
            {hz.shots} shot{hz.shots !== 1 ? 's' : ''} · {hz.goals} goal{hz.goals !== 1 ? 's' : ''}
          </div>
          <div className="text-muted-foreground">
            xG: {hz.xg.toFixed(2)} · conv: {hz.shots > 0 ? ((hz.goals / hz.shots) * 100).toFixed(0) : '0'}%
          </div>
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Shot density</span>
        <div className="flex items-center gap-0.5">
          {Array.from({ length: 7 }, (_, i) => {
            const t = i / 6
            const color = heatColor(Math.max(1, Math.round(t * maxCount)), maxCount)
            return (
              <div
                key={i}
                className="h-2.5 w-5 first:rounded-l-sm last:rounded-r-sm"
                style={{ background: color === 'transparent' ? BG_COLOR : color }}
              />
            )
          })}
          <span className="ml-1.5">Low → High</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-2.5 w-2.5 rounded-full bg-[#22c55e]" style={{ border: '1px solid #fff' }} />
          <span>Goal</span>
        </div>
        <span className="ml-auto text-[10px] opacity-70">Numbers = shots in zone</span>
      </div>
    </div>
  )
}