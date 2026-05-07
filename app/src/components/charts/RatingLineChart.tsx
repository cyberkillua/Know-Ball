import { useEffect, useState } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts'
import type { MatchRating } from '../../lib/types'

function ratingColor(r: number) {
  if (r >= 8) return '#22c55e'
  if (r >= 7) return '#84cc16'
  if (r >= 6) return '#eab308'
  if (r >= 5) return '#f97316'
  return '#ef4444'
}

function CustomDot(props: any) {
  const { cx, cy, payload, r } = props
  const color = ratingColor(Number(payload.rating))
  return <circle cx={cx} cy={cy} r={r ?? 5} fill={color} stroke="#0f1c2e" strokeWidth={1.5} />
}

function CustomActiveDot(props: any) {
  const { cx, cy, payload, r } = props
  const color = ratingColor(Number(payload.rating))
  return <circle cx={cx} cy={cy} r={r ?? 7} fill={color} stroke="#0f1c2e" strokeWidth={2} />
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' ? window.innerWidth < 640 : false,
  )
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 640)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return isMobile
}

export default function RatingLineChart({ ratings }: { ratings: MatchRating[] }) {
  const isMobile = useIsMobile()
  const data = ratings.map((r, i) => {
    const m = r.match as any
    const matchday = m?.matchday
    return {
      index: i,
      rating: Number(Number(r.final_rating).toFixed(2)),
      label: matchday != null ? `GW${matchday}` : `M${i + 1}`,
      fullDate: m?.date ?? '',
      matchday,
      home: m?.home_team?.name ?? '',
      away: m?.away_team?.name ?? '',
    }
  })

  const minRating = Math.min(...data.map((d) => d.rating))
  const yMin = Math.max(3, Math.floor(minRating) - 0.5)

  // Tick density: more sparse on mobile
  const tickEvery = isMobile
    ? data.length > 20
      ? 6
      : data.length > 12
        ? 4
        : data.length > 6
          ? 2
          : 1
    : data.length > 20
      ? 4
      : data.length > 10
        ? 2
        : 1
  const ticks = data.filter((_, i) => i % tickEvery === 0).map((d) => d.index)

  const dotR = isMobile ? 3.5 : 5
  const activeDotR = isMobile ? 5 : 7

  return (
    <div className="h-56 w-full sm:h-72">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data}
          margin={{
            top: 10,
            right: isMobile ? 8 : 16,
            left: isMobile ? -16 : -10,
            bottom: 8,
          }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
          <XAxis
            dataKey="index"
            type="number"
            domain={[0, data.length - 1]}
            ticks={ticks}
            tickFormatter={(i) => data[i]?.label ?? ''}
            tick={{ fontSize: isMobile ? 10 : 11, fill: 'var(--muted-foreground)' }}
            axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
            tickLine={false}
            interval={0}
          />
          <YAxis
            domain={[yMin, 10]}
            ticks={[4, 5, 6, 7, 8, 9, 10].filter((t) => t >= yMin)}
            tick={{ fontSize: isMobile ? 10 : 11, fill: 'var(--muted-foreground)' }}
            axisLine={false}
            tickLine={false}
            width={isMobile ? 24 : 28}
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
              <span style={{ color: ratingColor(Number(value)), fontWeight: 700, fontSize: 14 }}>
                {Number(value).toFixed(1)}
              </span>,
              'Rating',
            ]}
            labelFormatter={(idx: number) => {
              const d = data[idx]
              if (!d) return ''
              const matchup = d.home && d.away ? `${d.home} vs ${d.away}` : ''
              return (
                <span>
                  {matchup && <span style={{ display: 'block', fontWeight: 600 }}>{matchup}</span>}
                  {d.fullDate && <span style={{ opacity: 0.7 }}>{d.fullDate}</span>}
                </span>
              ) as any
            }}
          />
          {!isMobile && (
            <ReferenceLine
              y={6.5}
              stroke="rgba(255,255,255,0.2)"
              strokeDasharray="4 4"
              label={{
                value: 'avg',
                position: 'insideTopRight',
                fontSize: 10,
                fill: 'rgba(255,255,255,0.3)',
              }}
            />
          )}
          {isMobile && (
            <ReferenceLine y={6.5} stroke="rgba(255,255,255,0.2)" strokeDasharray="4 4" />
          )}
          <Line
            type="monotone"
            dataKey="rating"
            stroke="var(--primary)"
            strokeWidth={2}
            dot={<CustomDot r={dotR} />}
            activeDot={<CustomActiveDot r={activeDotR} />}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
