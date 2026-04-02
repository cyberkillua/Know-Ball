import { Link } from '@tanstack/react-router'
import { useState } from 'react'

const CATEGORY_META: Record<string, { color: string; label: string; icon: string; tooltip: string }> = {
  finishing: {
    color: 'var(--cat-finishing)',
    label: 'Best Finisher',
    icon: '\u26BD',
    tooltip: 'Goals scored, shot quality (xGOT vs xG), clinical finishing, and self-created chances.',
  },
  involvement: {
    color: 'var(--cat-involvement)',
    label: 'Most Creative',
    icon: '\uD83C\uDFAF',
    tooltip: 'Assists, expected assists, key passes, pass accuracy, and overall presence (touches).',
  },
  carrying: {
    color: 'var(--cat-carrying)',
    label: 'Best Carrier',
    icon: '\uD83D\uDCA8',
    tooltip: 'Successful dribbles, ball retention, and fouls won through carrying.',
  },
  physical: {
    color: 'var(--cat-physical)',
    label: 'Most Dominant',
    icon: '\uD83D\uDCAA',
    tooltip: 'Aerial duels won, ground duels won, and overall physical battle dominance.',
  },
  pressing: {
    color: 'var(--cat-pressing)',
    label: 'Best Defensive Performance',
    icon: '\uD83D\uDEE1\uFE0F',
    tooltip: 'Tackles won and interceptions — defensive work rate from a forward.',
  },
}

interface Props {
  category: string
  playerName: string
  playerId: number
  score: number
}

export default function CategoryKingCard({ category, playerName, playerId, score }: Props) {
  const meta = CATEGORY_META[category] ?? { color: '#888', label: category, icon: '', tooltip: '' }
  const [showTooltip, setShowTooltip] = useState(false)

  // Score is normalized to [-3, +3]. Map to 0–100% for the bar.
  const pct = Math.max(0, Math.min(100, ((score + 3) / 6) * 100))

  return (
    <div className="relative">
      <Link
        to="/player/$id"
        params={{ id: String(playerId) }}
        className="card-glow flex items-center gap-3 rounded-xl border border-border bg-card p-3 no-underline transition-all hover:bg-accent/30"
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
      >
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg"
          style={{ backgroundColor: `${meta.color}20`, color: meta.color }}
        >
          {meta.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: meta.color }}>
              {meta.label}
            </span>
          </div>
          <div className="text-sm font-medium text-foreground truncate mb-1.5">{playerName}</div>
          <div className="h-1.5 w-full rounded-full" style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}>
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${pct}%`, backgroundColor: meta.color, opacity: 0.85 }}
            />
          </div>
        </div>
      </Link>
      {showTooltip && (
        <div className="absolute left-12 bottom-full mb-2 z-50 max-w-64 rounded-lg border border-border bg-[#1A2A44] px-3 py-2 text-xs text-[#D6D3C4] shadow-lg">
          <span className="font-semibold" style={{ color: meta.color }}>{meta.label}</span>
          <p className="mt-1 leading-relaxed">{meta.tooltip}</p>
        </div>
      )}
    </div>
  )
}
