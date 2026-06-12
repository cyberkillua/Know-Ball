import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import {
  Radar,
  RadarChart as RechartsRadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Skeleton } from '../components/ui/skeleton'
import { getTeamProfile } from '../lib/queries'
import type { TeamProfileBundle, TeamStylePhase, TeamTendency } from '../lib/types'

export const Route = createFileRoute('/team/$id')({
  component: TeamProfilePage,
})

const AXIS_LABELS: Record<string, string> = {
  attack: 'Attack',
  midfield: 'Midfield',
  defence: 'Defence',
}

const PHASE_ORDER = ['attack', 'midfield', 'defence']

function StyleRadar({ axes }: { axes: Record<string, number> }) {
  const data = Object.keys(AXIS_LABELS).map((key) => ({
    axis: AXIS_LABELS[key],
    value: axes[key] ?? 0,
  }))
  return (
    <ResponsiveContainer width="100%" height={260}>
      <RechartsRadarChart data={data}>
        <PolarGrid stroke="var(--border)" />
        <PolarAngleAxis
          dataKey="axis"
          tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
        />
        <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
        <Radar
          dataKey="value"
          stroke="var(--primary)"
          fill="var(--primary)"
          fillOpacity={0.3}
        />
      </RechartsRadarChart>
    </ResponsiveContainer>
  )
}

function MetricChips({
  items,
  tone,
  emptyText = 'None stand out.',
}: {
  items: { key: string; label: string; value: number; percentile: number }[]
  tone: 'leading' | 'relative' | 'improve'
  emptyText?: string
}) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyText}</p>
  }
  const baseCls = {
    leading: 'border-emerald-500/30 bg-emerald-500/10',
    relative: 'border-primary/25 bg-primary/5',
    improve: '',
  }[tone]
  return (
    <div className="flex flex-col gap-2">
      {items.map((metric) => {
        const opportunityCls =
          metric.percentile <= 25
            ? 'border-red-500/40 bg-red-500/10'
            : metric.percentile <= 49
              ? 'border-orange-500/35 bg-orange-500/10'
              : metric.percentile <= 69
                ? 'border-amber-500/30 bg-amber-500/10'
                : 'border-sky-500/25 bg-sky-500/10'
        const cls = tone === 'improve' ? opportunityCls : baseCls
        return (
          <div
            key={metric.key}
            className={`flex items-center justify-between rounded-md border px-3 py-2 ${cls}`}
          >
            <span className="text-sm text-foreground">{metric.label}</span>
            <span className="text-xs font-medium text-muted-foreground">
              {metric.value} · {metric.percentile}th pct
            </span>
          </div>
        )
      })}
    </div>
  )
}

function PhaseCard({ phase }: { phase: TeamStylePhase }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-baseline justify-between gap-3">
          <CardTitle className="text-base">{phase.label}</CardTitle>
          <span className="text-sm font-semibold text-foreground">
            {phase.score}
            <span className="ml-1 text-xs font-normal text-muted-foreground">phase score</span>
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Relative strengths
          </h3>
          <MetricChips
            items={phase.relative_strengths}
            tone="relative"
            emptyText="No above-average strengths in this phase."
          />
        </div>
        <div>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Can improve
          </h3>
          <MetricChips
            items={phase.improvements}
            tone="improve"
            emptyText="All metrics in this phase are at or above the 90th percentile."
          />
        </div>
      </CardContent>
    </Card>
  )
}

function TendencyCard({ tendency }: { tendency: TeamTendency }) {
  const confidenceCls =
    tendency.confidence === 'high'
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500'
      : 'border-amber-500/30 bg-amber-500/10 text-amber-500'
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="text-base">{tendency.label}</CardTitle>
          <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${confidenceCls}`}>
            {tendency.confidence} confidence
          </span>
        </div>
        <p className="text-sm text-muted-foreground">{tendency.description}</p>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2">
          {tendency.evidence.map((metric) => (
            <span
              key={metric.key}
              className="rounded-full border border-border bg-secondary px-2 py-1 text-xs text-muted-foreground"
            >
              {metric.label}: {metric.percentile}th
            </span>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function TeamProfilePage() {
  const { id } = Route.useParams()
  const [bundle, setBundle] = useState<TeamProfileBundle | null>(null)
  const [loading, setLoading] = useState(true)
  const [season, setSeason] = useState<string | undefined>(undefined)

  useEffect(() => {
    let isCurrent = true
    setLoading(true)
    getTeamProfile({ data: { teamId: Number(id), season } }).then((result) => {
      if (!isCurrent) return
      setBundle(result)
      if (!season && result.season) setSeason(result.season)
      setLoading(false)
    })
    return () => {
      isCurrent = false
    }
  }, [id, season])

  if (loading && !bundle) {
    return (
      <div className="mx-auto max-w-5xl space-y-4 p-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (!bundle?.team) {
    return (
      <div className="mx-auto max-w-5xl p-8 text-center text-muted-foreground">
        Team not found.
      </div>
    )
  }

  const { team, style, seasons } = bundle

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4">
      <Link
        to="/"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </Link>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {team.logo_url && (
            <img src={team.logo_url} alt="" className="h-10 w-10 object-contain" />
          )}
          <div>
            <h1 className="text-2xl font-bold text-foreground">{team.name}</h1>
            <p className="text-sm text-muted-foreground">
              {team.league?.name}
              {style && ` · ${style.matches_played} matches`}
            </p>
          </div>
        </div>
        {seasons.length > 1 && (
          <select
            value={season}
            onChange={(event) => setSeason(event.target.value)}
            className="rounded-md border border-border bg-secondary px-2 py-1 text-sm"
          >
            {seasons.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        )}
      </div>

      {!style ? (
        <p className="text-muted-foreground">No analysis available for this season yet.</p>
      ) : (
        <>
          <section className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Phase profile</CardTitle>
              </CardHeader>
              <CardContent>
                <StyleRadar axes={style.axes} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">League-leading strengths</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Metrics at or above the 60th percentile in this league and season.
                </p>
              </CardHeader>
              <CardContent>
                <MetricChips
                  items={style.strengths}
                  tone="leading"
                  emptyText="No metrics currently clear the league-leading threshold."
                />
              </CardContent>
            </Card>
          </section>

          <section className="space-y-3">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Team tendencies</h2>
              <p className="text-sm text-muted-foreground">
                Evidence-backed descriptions of how the team tends to play. These describe style,
                not whether that style is successful.
              </p>
            </div>
            {style.tendencies?.length ? (
              <div className="grid gap-4 md:grid-cols-2">
                {style.tendencies.map((tendency) => (
                  <TendencyCard key={tendency.key} tendency={tendency} />
                ))}
              </div>
            ) : (
              <Card>
                <CardContent className="py-5 text-sm text-muted-foreground">
                  No strong multi-metric tendencies detected.
                </CardContent>
              </Card>
            )}
          </section>

          <section className="space-y-3">
            <div>
              <h2 className="text-lg font-semibold text-foreground">By phase</h2>
              <p className="text-sm text-muted-foreground">
                Relative strengths are above-average parts of this team's profile. Improvement
                areas show the biggest remaining opportunities in each phase.
              </p>
            </div>
            <div className="grid gap-4 lg:grid-cols-3">
              {PHASE_ORDER.map((key) => style.phases?.[key]).filter(Boolean).map((phase) => (
                <PhaseCard key={phase.label} phase={phase} />
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  )
}
