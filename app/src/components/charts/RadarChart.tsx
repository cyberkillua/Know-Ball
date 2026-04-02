import {
  Radar,
  RadarChart as RechartsRadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
} from 'recharts'
import { CATEGORY_LABELS, type RatingCategory } from '../../lib/types'

interface Props {
  categories: Record<RatingCategory, number>
  categories2?: Record<RatingCategory, number>
}

export default function RadarChart({ categories, categories2 }: Props) {
  const data = (Object.keys(categories) as RatingCategory[]).map((key) => ({
    category: CATEGORY_LABELS[key],
    value: categories[key],
    value2: categories2?.[key] ?? undefined,
  }))

  return (
    <ResponsiveContainer width="100%" height={250}>
      <RechartsRadarChart data={data}>
        <PolarGrid stroke="var(--border)" />
        <PolarAngleAxis
          dataKey="category"
          tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
        />
        <PolarRadiusAxis
          domain={[-3, 3]}
          tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
          axisLine={false}
        />
        <Radar
          name="Player"
          dataKey="value"
          stroke="var(--primary)"
          fill="var(--primary)"
          fillOpacity={0.2}
          strokeWidth={2}
        />
        {categories2 && (
          <Radar
            name="Comparison"
            dataKey="value2"
            stroke="var(--chart-2)"
            fill="var(--chart-2)"
            fillOpacity={0.15}
            strokeWidth={2}
          />
        )}
      </RechartsRadarChart>
    </ResponsiveContainer>
  )
}
