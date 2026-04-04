import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts'

interface PizzaChartProps {
  data: { label: string; percentile: number; inverted?: boolean }[]
  size?: number
}

const getPercentileColor = (percentile: number): string => {
  if (percentile >= 80) return '#1d9e75' // Green - elite
  if (percentile >= 60) return '#5cb85c' // Light green - good
  if (percentile >= 40) return '#ef9f27' // Amber - average
  if (percentile >= 20) return '#e57373' // Light red - below average
  return '#e24b4a' // Red - poor
}

const COLOR_RANGES = [
  { min: 80, max: 100, color: '#1d9e75', label: '80-100' },
  { min: 60, max: 80, color: '#5cb85c', label: '60-80' },
  { min: 40, max: 60, color: '#ef9f27', label: '40-60' },
  { min: 20, max: 40, color: '#e57373', label: '20-40' },
  { min: 0, max: 20, color: '#e24b4a', label: '0-20' },
]

export default function PizzaChart({ data, size = 540 }: PizzaChartProps) {
  const numSlices = data.length
  const anglePerSlice = 360 / numSlices
  const center = size / 2
  const maxRadius = (size / 2) - 55
  const minRadius = 40

  // Convert percentile (0-100) to radius
  const getRadius = (percentile: number) => {
    return minRadius + (maxRadius - minRadius) * (Math.max(0, Math.min(100, percentile)) / 100)
  }

  // Generate path for each slice
  const generateSlicePath = (index: number, percentile: number) => {
    const startAngle = 90 - (index * anglePerSlice)
    const endAngle = startAngle - anglePerSlice
    const outerRadius = getRadius(percentile)

    const startRad = (startAngle * Math.PI) / 180
    const endRad = (endAngle * Math.PI) / 180

    const largeArc = anglePerSlice > 180 ? 1 : 0

    // Background slice points
    const outerX1 = center + maxRadius * Math.cos(startRad)
    const outerY1 = center - maxRadius * Math.sin(startRad)
    const outerX2 = center + maxRadius * Math.cos(endRad)
    const outerY2 = center - maxRadius * Math.sin(endRad)
    const innerX1 = center + minRadius * Math.cos(startRad)
    const innerY1 = center - minRadius * Math.sin(startRad)
    const innerX2 = center + minRadius * Math.cos(endRad)
    const innerY2 = center - minRadius * Math.sin(endRad)

    // Filled slice points
    const fillX1 = center + outerRadius * Math.cos(startRad)
    const fillY1 = center - outerRadius * Math.sin(startRad)
    const fillX2 = center + outerRadius * Math.cos(endRad)
    const fillY2 = center - outerRadius * Math.sin(endRad)

    return {
      bgPath: `M ${outerX1} ${outerY1} A ${maxRadius} ${maxRadius} 0 ${largeArc} 0 ${outerX2} ${outerY2} L ${innerX2} ${innerY2} A ${minRadius} ${minRadius} 0 ${largeArc} 1 ${innerX1} ${innerY1} Z`,
      fillPath: `M ${fillX1} ${fillY1} A ${outerRadius} ${outerRadius} 0 ${largeArc} 0 ${fillX2} ${fillY2} L ${innerX2} ${innerY2} A ${minRadius} ${minRadius} 0 ${largeArc} 1 ${innerX1} ${innerY1} Z`,
    }
  }

  // Get position for label outside the chart
  const getLabelPosition = (index: number) => {
    const midAngle = 90 - (index * anglePerSlice) - (anglePerSlice / 2)
    const rad = (midAngle * Math.PI) / 180
    const labelRadius = maxRadius + 25
    return {
      x: center + labelRadius * Math.cos(rad),
      y: center - labelRadius * Math.sin(rad),
      angle: midAngle,
    }
  }

  // Get position for percentile - fixed position within slice
  const getPctPosition = (index: number) => {
    const midAngle = 90 - (index * anglePerSlice) - (anglePerSlice / 2)
    const rad = (midAngle * Math.PI) / 180
    const radius = minRadius + (maxRadius - minRadius) * 0.55
    return {
      x: center + radius * Math.cos(rad),
      y: center - radius * Math.sin(rad),
    }
  }

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      <svg width={size} height={size} style={{ overflow: 'visible' }}>
        {/* Background slices */}
        {data.map((d, i) => {
          const { bgPath } = generateSlicePath(i, 100)
          return (
            <path
              key={`bg-${i}`}
              d={bgPath}
              fill="var(--muted)"
              fillOpacity={0.08}
              stroke="var(--border)"
              strokeWidth={0.5}
            />
          )
        })}

        {/* Filled slices */}
        {data.map((d, i) => {
          const displayPct = d.inverted ? 100 - d.percentile : d.percentile
          const { fillPath } = generateSlicePath(i, displayPct)
          return (
            <path
              key={`fill-${i}`}
              d={fillPath}
              fill={getPercentileColor(displayPct)}
              fillOpacity={0.85}
              stroke={getPercentileColor(displayPct)}
              strokeWidth={1}
            />
          )
        })}

        {/* Grid circles */}
        {[25, 50, 75].map((pct) => {
          const r = minRadius + (maxRadius - minRadius) * (pct / 100)
          return (
            <circle
              key={`grid-${pct}`}
              cx={center}
              cy={center}
              r={r}
              fill="none"
              stroke="var(--border)"
              strokeOpacity={0.12}
              strokeDasharray="1 2"
            />
          )
        })}
        <circle cx={center} cy={center} r={minRadius} fill="none" stroke="var(--border)" strokeOpacity={0.15} />
        <circle cx={center} cy={center} r={maxRadius} fill="none" stroke="var(--border)" strokeOpacity={0.15} />

        {/* Radial lines */}
        {data.map((_, i) => {
          const angle = 90 - (i * anglePerSlice)
          const rad = (angle * Math.PI) / 180
          const x = center + maxRadius * Math.cos(rad)
          const y = center - maxRadius * Math.sin(rad)
          return (
            <line
              key={`radial-${i}`}
              x1={center}
              y1={center}
              x2={x}
              y2={y}
              stroke="var(--border)"
              strokeOpacity={0.15}
              strokeWidth={0.5}
            />
          )
        })}

        {/* Center circle */}
        <circle cx={center} cy={center} r={minRadius - 8} fill="var(--card)" stroke="var(--border)" strokeWidth={1} />

        {/* Percentile values on slices - white text */}
        {data.map((d, i) => {
          const pos = getPctPosition(i)
          return (
            <text
              key={`pct-${i}`}
              x={pos.x}
              y={pos.y}
              textAnchor="middle"
              dominantBaseline="middle"
              style={{
                fontSize: 11,
                fill: 'white',
                fontWeight: 700,
              }}
            >
              {Math.round(d.percentile)}
            </text>
          )
        })}

        {/* Labels outside the chart */}
        {data.map((d, i) => {
          const pos = getLabelPosition(i)

          return (
            <text
              key={`label-${i}`}
              x={pos.x}
              y={pos.y}
              textAnchor="middle"
              dominantBaseline="middle"
              style={{
                fontSize: 9,
                fill: d.inverted ? 'var(--muted-foreground)' : 'var(--foreground)',
                fontWeight: 500,
              }}
            >
              {d.inverted ? `▼ ${d.label}` : d.label}
            </text>
          )
        })}
      </svg>

      {/* Legend */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 12, flexWrap: 'wrap', fontSize: 11 }}>
        {COLOR_RANGES.map((range) => (
          <div key={range.label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div
              style={{
                width: 14,
                height: 14,
                borderRadius: 3,
                background: range.color,
              }}
            />
            <span style={{ color: 'var(--muted-foreground)' }}>{range.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}