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
import type { TeamProfileBundle } from '../lib/types'

export const Route = createFileRoute('/team/$id')({
  component: TeamProfilePage,
})

const AXIS_LABELS: Record<string, string> = {
  attack: 'Attack',
  creation: 'Creation',
  possession: 'Possession',
  defending: 'Defending',
  finishing: 'Finishing',
}

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
}: {
  items: { key: string; label: string; value: number; percentile: number }[]
  tone: 'good' | 'bad'
}) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">None stand out.</p>
  }
  const cls =
    tone === 'good'
      ? 'border-emerald-500/30 bg-emerald-500/10'
      : 'border-red-500/30 bg-red-500/10'
  return (
    <div className="flex flex-col gap-2">
      {items.map((metric) => (
        <div
          key={metric.key}
          className={`flex items-center justify-between rounded-md border px-3 py-2 ${cls}`}
        >
          <span className="text-sm text-foreground">{metric.label}</span>
          <span className="text-xs font-medium text-muted-foreground">
            {metric.value} · {metric.percentile}th pct
          </span>
        </div>
      ))}
    </div>
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
        <section className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Style identity</CardTitle>
            </CardHeader>
            <CardContent>
              <StyleRadar axes={style.axes} />
            </CardContent>
          </Card>
          <div className="grid gap-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm text-muted-foreground">
                  What they're good at
                </CardTitle>
              </CardHeader>
              <CardContent>
                <MetricChips items={style.strengths} tone="good" />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm text-muted-foreground">
                  Where they fall short
                </CardTitle>
              </CardHeader>
              <CardContent>
                <MetricChips items={style.weaknesses} tone="bad" />
              </CardContent>
            </Card>
          </div>
        </section>
      )}
    </div>
  )
}
