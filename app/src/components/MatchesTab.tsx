import { useState } from "react"
import { ChevronDown } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card"
import RatingLineChart from "./charts/RatingLineChart"
import type { MatchRating } from "../lib/types"

function ratingTone(r: number): { fill: string; text: string } {
  if (r >= 8) return { fill: "bg-rating-high", text: "text-rating-high" }
  if (r >= 7) return { fill: "bg-band-good", text: "text-band-good" }
  if (r >= 6) return { fill: "bg-band-warn", text: "text-band-warn" }
  return { fill: "bg-band-bad", text: "text-band-bad" }
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })
}

interface Props {
  ratings: MatchRating[]
  /** Fallback when a per-match team_id is missing (e.g. legacy data without match_player_stats join). */
  playerTeamId: number | null
  /** Competition label shown on the collapsible group header (e.g. "Premier League 2025/2026"). */
  competitionLabel: string
}

export default function MatchesTab({ ratings, playerTeamId, competitionLabel }: Props) {
  if (ratings.length === 0) {
    return (
      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Match Ratings</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No rating data for this season.</p>
        </CardContent>
      </Card>
    )
  }

  // KPIs
  const ratingValues = ratings.map((r) => Number(r.final_rating))
  const avgRating = ratingValues.reduce((a, b) => a + b, 0) / ratingValues.length

  // Best / worst by rating
  const bestRatingValue = Math.max(...ratingValues)
  const worstRatingValue = Math.min(...ratingValues)

  // Form: last 5 matches by date (most recent first)
  const sorted = [...ratings].sort((a, b) => {
    const da = (a.match as any)?.date ?? ""
    const db = (b.match as any)?.date ?? ""
    return db.localeCompare(da)
  })
  const lastFive = sorted.slice(0, 5)

  // Sort match list most recent first
  const listRows = sorted

  return (
    <div className="mt-4 flex flex-col gap-4">
      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiTile label="Avg" value={avgRating.toFixed(2)} tone={ratingTone(avgRating).text} />
        <KpiTile
          label="Best"
          value={bestRatingValue.toFixed(2)}
          tone={ratingTone(bestRatingValue).text}
        />
        <KpiTile
          label="Worst"
          value={worstRatingValue.toFixed(2)}
          tone={ratingTone(worstRatingValue).text}
        />
        <div className="rounded-lg border border-border bg-card px-3 py-2.5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Last 5
          </div>
          <div className="mt-1.5 flex items-center gap-1">
            {lastFive.length > 0 ? (
              lastFive
                .slice()
                .reverse()
                .map((r, i) => {
                  const v = Number(r.final_rating)
                  const tone = ratingTone(v)
                  return (
                    <span
                      key={`${r.id}-${i}`}
                      className={`inline-block h-3 w-3 rounded-full ${tone.fill}`}
                      title={`${v.toFixed(2)} · ${formatDate((r.match as any)?.date)}`}
                    />
                  )
                })
            ) : (
              <span className="text-xs text-muted-foreground">—</span>
            )}
          </div>
        </div>
      </div>

      {/* Chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle>Rating History</CardTitle>
        </CardHeader>
        <CardContent>
          <RatingLineChart ratings={ratings} />
        </CardContent>
      </Card>

      {/* Match list */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle>Matches</CardTitle>
        </CardHeader>
        <CardContent className="px-0 sm:px-6">
          <CompetitionGroup label={competitionLabel} count={listRows.length}>
          <ul className="divide-y divide-border/60">
            {listRows.map((r) => {
              const m = (r.match as any) ?? {}
              const home = m.home_team?.name ?? "Home"
              const away = m.away_team?.name ?? "Away"
              // Prefer the per-match team_id (from match_player_stats); fall back to current team only when missing.
              const matchTeamId = r.player_team_id ?? playerTeamId
              const isHome = matchTeamId != null && m.home_team_id === matchTeamId
              const isAway = matchTeamId != null && m.away_team_id === matchTeamId
              const knownSide = isHome || isAway
              const opponent = isHome ? away : isAway ? home : `${home} vs ${away}`
              const venue = isHome ? "vs" : isAway ? "@" : ""
              const score =
                m.home_score != null && m.away_score != null
                  ? `${m.home_score}-${m.away_score}`
                  : null
              const playerScore =
                m.home_score != null && m.away_score != null && knownSide
                  ? isHome
                    ? `${m.home_score}-${m.away_score}`
                    : `${m.away_score}-${m.home_score}`
                  : null
              const result =
                m.home_score != null && m.away_score != null && knownSide
                  ? isHome
                    ? m.home_score > m.away_score
                      ? "W"
                      : m.home_score < m.away_score
                        ? "L"
                        : "D"
                    : m.away_score > m.home_score
                      ? "W"
                      : m.away_score < m.home_score
                        ? "L"
                        : "D"
                  : null
              const resultTone =
                result === "W"
                  ? "text-band-good"
                  : result === "L"
                    ? "text-band-bad"
                    : "text-muted-foreground"
              const rating = Number(r.final_rating)
              const tone = ratingTone(rating)
              return (
                <li
                  key={r.id}
                  className="flex min-w-0 items-center gap-3 px-4 py-2.5 sm:px-0"
                >
                  <div className="hidden w-12 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground sm:block">
                    {m.matchday != null ? `GW${m.matchday}` : ""}
                  </div>
                  <div className="w-16 shrink-0 text-[11px] text-muted-foreground sm:w-20">
                    {formatDate(m.date)}
                    {m.matchday != null && (
                      <span className="block sm:hidden">GW{m.matchday}</span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-[11px] font-medium text-muted-foreground">
                        {venue}
                      </span>
                      <span className="truncate text-sm font-semibold text-foreground">
                        {opponent}
                      </span>
                    </div>
                    {playerScore && (
                      <div className="text-[11px] text-muted-foreground">
                        {result && (
                          <span className={`mr-1 font-bold ${resultTone}`}>{result}</span>
                        )}
                        <span className="tabular-nums">{playerScore}</span>
                      </div>
                    )}
                    {!playerScore && score && (
                      <div className="text-[11px] tabular-nums text-muted-foreground">{score}</div>
                    )}
                  </div>
                  <div
                    className={`shrink-0 rounded-md px-2 py-1 text-sm font-bold tabular-nums text-white ${tone.fill}`}
                  >
                    {rating.toFixed(1)}
                  </div>
                </li>
              )
            })}
          </ul>
          </CompetitionGroup>
        </CardContent>
      </Card>
    </div>
  )
}

function CompetitionGroup({
  label,
  count,
  children,
}: {
  label: string
  count: number
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(true)
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full min-h-9 items-center justify-between gap-3 px-4 py-2 text-left transition-colors hover:bg-accent/40 sm:px-0"
      >
        <span className="truncate text-sm font-semibold text-foreground">{label}</span>
        <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
          <span className="tabular-nums">{count}</span>
          <ChevronDown
            size={16}
            className={`transition-transform ${open ? "rotate-180" : ""}`}
          />
        </span>
      </button>
      {open && <div className="border-t border-border/60">{children}</div>}
    </div>
  )
}

function KpiTile({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2.5">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1 text-xl font-bold tabular-nums ${tone}`}>{value}</div>
    </div>
  )
}
