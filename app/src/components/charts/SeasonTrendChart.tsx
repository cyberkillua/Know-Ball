import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { PlayerSeasonTrendPoint } from '../../lib/types'

function scoreColor(score: number) {
  if (score >= 70) return '#1d9e75'
  if (score >= 55) return '#5cb85c'
  if (score >= 40) return '#ef9f27'
  if (score >= 25) return '#e57373'
  return '#e24b4a'
}

function compactSeasonLabel(season: string) {
  const match = season.match(/^(\d{4})[/-](\d{4})$/)
  if (!match) return season
  return `${match[1]}/${match[2].slice(-2)}`
}

function ScoreDot(props: any) {
  const { cx, cy, payload } = props
  if (cx == null || cy == null) return null

  const score = Number(payload.score)
  const isCurrent = Boolean(payload.isCurrent)

  return (
    <circle
      cx={cx}
      cy={cy}
      r={isCurrent ? 6 : 4.5}
      fill={scoreColor(score)}
      stroke={isCurrent ? 'var(--foreground)' : '#0f1c2e'}
      strokeWidth={isCurrent ? 2 : 1.5}
    />
  )
}

function ActiveScoreDot(props: any) {
  const { cx, cy, payload } = props
  if (cx == null || cy == null) return null

  const score = Number(payload.score)

  return (
    <circle
      cx={cx}
      cy={cy}
      r={7}
      fill={scoreColor(score)}
      stroke="var(--foreground)"
      strokeWidth={2}
    />
  )
}

export default function SeasonTrendChart({
  activeSeasonKey,
  points,
}: {
  activeSeasonKey: string
  points: PlayerSeasonTrendPoint[]
}) {
  const validPoints = points.filter((point) => {
    const score = Number(point.model_score)
    return point.model_score != null && Number.isFinite(score)
  })

  if (validPoints.length === 0) return null

  const data = validPoints.map((point, index) => {
    const score = Number(point.model_score)
    return {
      index,
      score: Number(score.toFixed(1)),
      season: point.season,
      label: compactSeasonLabel(point.season),
      leagueName: point.league_name ?? 'League',
      matches: point.matches_played ?? 0,
      minutes: point.minutes_played ?? 0,
      confidence: point.model_score_confidence,
      avgMatchRating: point.avg_match_rating,
      isCurrent: `${point.league_id}|${point.season}` === activeSeasonKey,
    }
  })

  const scores = data.map((point) => point.score)
  const rawMin = Math.min(...scores)
  const rawMax = Math.max(...scores)
  let yMin = Math.max(0, Math.floor((rawMin - 8) / 10) * 10)
  let yMax = Math.min(100, Math.ceil((rawMax + 8) / 10) * 10)

  if (yMax - yMin < 20) {
    yMin = Math.max(0, yMin - 10)
    yMax = Math.min(100, yMax + 10)
  }

  const tickStep = yMax - yMin > 50 ? 20 : 10
  const yTicks = []
  for (let tick = yMin; tick <= yMax; tick += tickStep) {
    yTicks.push(tick)
  }

  const tickEvery = data.length > 8 ? 2 : 1
  const xTicks = data.filter((_, index) => index % tickEvery === 0).map((point) => point.index)
  const xDomain: [number, number] = data.length === 1 ? [-0.5, 0.5] : [0, data.length - 1]

  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data} margin={{ top: 8, right: 18, left: -8, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
        <XAxis
          dataKey="index"
          type="number"
          domain={xDomain}
          ticks={xTicks}
          tickFormatter={(value) => data[Number(value)]?.label ?? ''}
          tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
          axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
          tickLine={false}
          interval={0}
        />
        <YAxis
          domain={[yMin, yMax]}
          ticks={yTicks}
          tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
          axisLine={false}
          tickLine={false}
          width={30}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: '#1A2A44',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '0.5rem',
            color: '#F2F0EB',
            fontSize: 12,
          }}
          formatter={(value: any) => [
            <span style={{ color: scoreColor(Number(value)), fontWeight: 700, fontSize: 14 }}>
              {Number(value).toFixed(1)}
            </span>,
            'Know Ball Score',
          ]}
          labelFormatter={(value: number) => {
            const point = data[Number(value)]
            if (!point) return ''

            return (
              <span>
                <span style={{ display: 'block', fontWeight: 700 }}>{point.season}</span>
                <span style={{ display: 'block', opacity: 0.78 }}>{point.leagueName}</span>
                <span style={{ display: 'block', marginTop: 4, opacity: 0.72 }}>
                  {point.matches} apps - {Number(point.minutes).toLocaleString()} mins
                </span>
                {point.avgMatchRating != null && (
                  <span style={{ display: 'block', opacity: 0.72 }}>
                    Avg match rating {Number(point.avgMatchRating).toFixed(2)}
                  </span>
                )}
                {point.confidence != null && (
                  <span style={{ display: 'block', opacity: 0.72 }}>
                    {Math.round(Number(point.confidence))}% confidence
                  </span>
                )}
              </span>
            ) as any
          }}
        />
        {yMin <= 50 && yMax >= 50 && (
          <ReferenceLine
            y={50}
            stroke="rgba(255,255,255,0.18)"
            strokeDasharray="4 4"
            label={{ value: '50', position: 'insideTopRight', fontSize: 10, fill: 'rgba(255,255,255,0.35)' }}
          />
        )}
        <Line
          type="monotone"
          dataKey="score"
          stroke="var(--primary)"
          strokeWidth={2}
          dot={<ScoreDot />}
          activeDot={<ActiveScoreDot />}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
