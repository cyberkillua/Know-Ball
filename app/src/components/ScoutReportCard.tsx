import { ArrowDown, ArrowUp } from "lucide-react"

type Tone = "good" | "warn" | "bad" | "muted"

export type ScoutMetric = {
  key: string
  label: string
  valueText: string
  tone: Tone
}

function toneTextClass(tone: Tone) {
  if (tone === "good") return "text-band-good"
  if (tone === "warn") return "text-band-warn"
  if (tone === "bad") return "text-band-bad"
  return "text-foreground"
}

interface Props {
  title: string
  headline: string
  ratedMinutes: number
  comparisonPool: string
  mainValue: ScoutMetric[]
  useForItems: string[]
  cautionItems: string[]
  emptyCautionText: string
  evidenceRows: ScoutMetric[]
  seasonRows: ScoutMetric[]
  seasonTitle: string
}

export default function ScoutReportCard({
  title,
  headline,
  ratedMinutes,
  comparisonPool,
  mainValue,
  useForItems,
  cautionItems,
  emptyCautionText,
  evidenceRows,
  seasonRows,
  seasonTitle,
}: Props) {
  return (
    <div className="flex flex-col gap-4 rounded-lg bg-muted px-3.5 py-3 sm:px-4 sm:py-4">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            {title}
          </div>
          <div className="mt-1 text-[15px] font-bold leading-snug text-foreground sm:text-base">
            {headline}
          </div>
        </div>
        <div className="text-[11px] text-muted-foreground sm:shrink-0 sm:text-right">
          <span className="tabular-nums">{ratedMinutes}</span> rated mins
          <span className="px-1.5 sm:hidden">·</span>
          <span className="hidden sm:inline"><br /></span>
          {comparisonPool}
        </div>
      </div>

      {/* Main Value — full-width, inline data */}
      <div>
        <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          Main Value
        </div>
        {mainValue.length > 0 ? (
          <div className="flex flex-wrap gap-x-5 gap-y-1.5">
            {mainValue.map((row) => (
              <div key={row.key} className="flex items-baseline gap-1.5 text-xs">
                <span className="text-muted-foreground">{row.label}</span>
                <span className={`font-bold tabular-nums ${toneTextClass(row.tone)}`}>
                  {row.valueText}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">No strong signal yet.</span>
        )}
      </div>

      {/* Use him for / Caution */}
      <div className="grid items-stretch gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2 rounded-md border border-band-good/20 bg-band-good/5 p-3">
          <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-band-good">
            <ArrowUp size={12} strokeWidth={3} />
            <span>Use him for</span>
          </div>
          {useForItems.length > 0 ? (
            <ul className="flex flex-col gap-1.5">
              {useForItems.slice(0, 3).map((item) => (
                <li key={item} className="flex gap-2 text-xs leading-relaxed text-foreground">
                  <span aria-hidden className="mt-1 h-1 w-1 shrink-0 rounded-full bg-band-good" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-xs text-muted-foreground">No strong usage signal yet.</span>
          )}
        </div>

        <div className="flex flex-col gap-2 rounded-md border border-band-warn/20 bg-band-warn/5 p-3">
          <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-band-warn">
            <ArrowDown size={12} strokeWidth={3} />
            <span>Caution</span>
          </div>
          {cautionItems.length > 0 ? (
            <ul className="flex flex-col gap-1.5">
              {cautionItems.slice(0, 3).map((item) => (
                <li key={item} className="flex gap-2 text-xs leading-relaxed text-foreground">
                  <span aria-hidden className="mt-1 h-1 w-1 shrink-0 rounded-full bg-band-warn" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-xs text-muted-foreground">{emptyCautionText}</span>
          )}
        </div>
      </div>

      {/* Evidence + Season Context */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            Core Evidence
          </div>
          <div className="grid grid-cols-2 gap-2">
            {evidenceRows.map((row) => (
              <div key={row.key} className="rounded-md border border-border bg-card px-2.5 py-2">
                <div className="text-[11px] text-muted-foreground">{row.label}</div>
                <div className={`mt-0.5 text-sm font-extrabold ${toneTextClass(row.tone)}`}>
                  {row.valueText}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            {seasonTitle}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {seasonRows.map((row) => (
              <div key={row.key} className="rounded-md border border-border bg-card px-2.5 py-2">
                <div className="text-[11px] text-muted-foreground">{row.label}</div>
                <div className={`mt-0.5 text-sm font-extrabold ${toneTextClass(row.tone)}`}>
                  {row.valueText}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
