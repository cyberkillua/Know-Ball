interface StatRowProps {
  label: string
  value: string
  percentile?: number
}

function toneClasses(pct: number) {
  if (pct >= 70) return { fill: 'bg-band-good', text: 'text-band-good' }
  if (pct >= 40) return { fill: 'bg-band-warn', text: 'text-band-warn' }
  return { fill: 'bg-band-bad', text: 'text-band-bad' }
}

export default function StatRow({ label, value, percentile }: StatRowProps) {
  if (percentile === undefined) {
    return (
      <div className="mb-1 flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
        <span className="truncate text-[11px] text-muted-foreground sm:w-40 sm:shrink-0 sm:whitespace-nowrap sm:text-right">
          {label}
        </span>
        <div className="flex h-[18px] flex-1 items-center rounded bg-muted px-2">
          <span className="text-[11px] font-semibold text-foreground">{value}</span>
        </div>
        <span className="hidden sm:block sm:w-6 sm:shrink-0" />
      </div>
    )
  }

  const pct = Math.min(100, Math.max(0, percentile))
  const barWidth = Math.max(pct, 8)
  const tone = toneClasses(pct)

  return (
    <div className="mb-1 flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
      <div className="flex items-center justify-between gap-2 sm:contents">
        <span className="min-w-0 truncate text-[11px] text-muted-foreground sm:w-40 sm:shrink-0 sm:whitespace-nowrap sm:text-right">
          {label}
        </span>
        <span className={`text-[11px] font-semibold tabular-nums sm:order-3 sm:w-6 sm:shrink-0 sm:text-right ${tone.text}`}>
          {Math.round(pct)}
        </span>
      </div>
      <div className="relative h-[18px] flex-1 overflow-hidden rounded bg-muted sm:order-2">
        <div
          className={`flex h-full items-center rounded px-1.5 ${tone.fill}`}
          style={{ width: `${barWidth}%` }}
        >
          <span className="truncate text-[11px] font-semibold text-white">{value}</span>
        </div>
      </div>
    </div>
  )
}
