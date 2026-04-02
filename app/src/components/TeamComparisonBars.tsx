interface StatRow {
  label: string
  homeVal: number
  awayVal: number
  format?: (v: number) => string
}

interface Props {
  homeName: string
  awayName: string
  stats: StatRow[]
}

export default function TeamComparisonBars({ homeName, awayName, stats }: Props) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-sm font-semibold">
        <span>{homeName}</span>
        <span>{awayName}</span>
      </div>
      {stats.map((s) => {
        const total = s.homeVal + s.awayVal || 1
        const homePct = (s.homeVal / total) * 100
        const awayPct = (s.awayVal / total) * 100
        const fmt = s.format ?? ((v: number) => String(v))
        const homeWins = s.homeVal > s.awayVal
        const awayWins = s.awayVal > s.homeVal

        return (
          <div key={s.label}>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className={`tabular-nums font-medium ${homeWins ? 'text-foreground' : 'text-muted-foreground'}`}>
                {fmt(s.homeVal)}
              </span>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{s.label}</span>
              <span className={`tabular-nums font-medium ${awayWins ? 'text-foreground' : 'text-muted-foreground'}`}>
                {fmt(s.awayVal)}
              </span>
            </div>
            <div className="flex h-2 gap-0.5">
              <div
                className="h-full rounded-l-full transition-all duration-700"
                style={{
                  width: `${Math.max(8, homePct)}%`,
                  backgroundColor: homeWins ? 'var(--cat-finishing)' : 'var(--muted)',
                }}
              />
              <div
                className="h-full rounded-r-full transition-all duration-700"
                style={{
                  width: `${Math.max(8, awayPct)}%`,
                  backgroundColor: awayWins ? 'var(--cat-involvement)' : 'var(--muted)',
                }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}
