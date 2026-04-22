import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from 'recharts'

interface Props {
  ratings: { final_rating: number }[]
  position?: string
}

const BUCKETS = [
  { label: '3', min: 3, max: 4, color: '#ef4444' },
  { label: '4', min: 4, max: 5, color: '#ef4444' },
  { label: '5', min: 5, max: 6, color: '#f97316' },
  { label: '6', min: 6, max: 7, color: '#a3a3a3' },
  { label: '7', min: 7, max: 8, color: '#22c55e' },
  { label: '8', min: 8, max: 9, color: '#10b981' },
  { label: '9', min: 9, max: 10.1, color: '#10b981' },
]

export default function RatingDistributionChart({ ratings, position }: Props) {
  const data = BUCKETS.map((b) => ({
    name: b.label,
    count: ratings.filter((r) => Number(r.final_rating) >= b.min && Number(r.final_rating) < b.max).length,
    color: b.color,
  }))

  return (
    <div>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: -20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="name"
            tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#1A2A44',
              border: '1px solid #2A3F5F',
              borderRadius: '8px',
              fontSize: 12,
              color: '#F2F0EB',
            }}
            labelStyle={{ color: '#F2F0EB', fontWeight: 600 }}
            itemStyle={{ color: '#D6D3C4' }}
            formatter={(value: number) => [`${value} players`, 'Count']}
          />
          <Bar dataKey="count" radius={[4, 4, 0, 0]}>
            {data.map((entry, i) => (
              <Cell key={i} fill={entry.color} fillOpacity={0.85} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <p className="mt-1 text-center text-[11px] text-muted-foreground">
        {position ?? 'ST'} only &middot; 6.5–7 = average &middot; {ratings.length} rated
      </p>
    </div>
  )
}
