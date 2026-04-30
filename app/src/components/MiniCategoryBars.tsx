const CATEGORIES = [
  { key: 'finishing', color: 'var(--cat-finishing)' },
  { key: 'involvement', color: 'var(--cat-involvement)' },
  { key: 'carrying', color: 'var(--cat-carrying)' },
  { key: 'physical', color: 'var(--cat-physical)' },
  { key: 'pressing', color: 'var(--cat-pressing)' },
] as const

interface Props {
  finishing: number
  involvement: number
  carrying: number
  physical: number
  pressing: number
  /** 'norm' = normalized scores [-3, +3], 'pct' = percentile values [0, 10] */
  mode?: 'norm' | 'pct'
  labels?: Partial<Record<(typeof CATEGORIES)[number]['key'], string>>
}

function toPct(value: number, mode: 'norm' | 'pct'): number {
  if (mode === 'pct') {
    // Values are 0–10, map linearly
    return Math.max(0, Math.min(100, (value / 10) * 100))
  }
  // Normalized scores: -3 to +3, map to 0–100%
  return Math.max(0, Math.min(100, ((value + 3) / 6) * 100))
}

function scoreLabel(value: number): string {
  if (value >= 2.0) return 'Elite'
  if (value >= 1.0) return 'Good'
  if (value >= 0) return 'Avg'
  if (value >= -1.0) return 'Below'
  return 'Poor'
}

export default function MiniCategoryBars({ finishing, involvement, carrying, physical, pressing, mode = 'norm' }: Props) {
  const values = { finishing, involvement, carrying, physical, pressing }

  return (
    <div className="flex items-center gap-0.5">
      {CATEGORIES.map(({ key, color }) => (
        <div key={key} className="relative h-5 w-3 rounded-sm" style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}>
          <div
            className="absolute bottom-0 w-full rounded-sm transition-all duration-500"
            style={{
              height: `${toPct(Number(values[key]), mode)}%`,
              backgroundColor: color,
              opacity: 0.85,
            }}
          />
        </div>
      ))}
    </div>
  )
}

export function MiniCategoryBarsLabeled({ finishing, involvement, carrying, physical, pressing, mode = 'norm', labels }: Props) {
  const values = { finishing, involvement, carrying, physical, pressing }

  const LABELS: Record<string, string> = {
    finishing: 'Finishing',
    involvement: 'Involvement',
    carrying: 'Carrying',
    physical: 'Physical',
    pressing: 'Def. Effort',
  }

  return (
    <div className="space-y-1.5">
      {CATEGORIES.map(({ key, color }) => (
        <div key={key} className="flex items-center gap-2">
          <span className="w-20 text-right text-xs text-muted-foreground">{labels?.[key] ?? LABELS[key]}</span>
          <div className="relative h-2 flex-1 rounded-full" style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}>
            <div
              className="absolute left-0 top-0 h-full rounded-full transition-all duration-700"
              style={{
                width: `${toPct(Number(values[key]), mode)}%`,
                backgroundColor: color,
              }}
            />
          </div>
          <span className="w-10 text-right text-[10px] font-medium" style={{ color }}>
            {mode === 'pct' ? `${Math.round(Number(values[key]) * 10)}%` : scoreLabel(Number(values[key]))}
          </span>
        </div>
      ))}
    </div>
  )
}
