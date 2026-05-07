interface PizzaChartProps {
  data: { label: string; percentile: number; inverted?: boolean }[]
}

const getPercentileColor = (percentile: number): string => {
  if (percentile >= 80) return '#1d9e75'
  if (percentile >= 60) return '#5cb85c'
  if (percentile >= 40) return '#ef9f27'
  if (percentile >= 20) return '#e57373'
  return '#e24b4a'
}

const COLOR_RANGES = [
  { min: 80, max: 100, color: '#1d9e75', label: '80-100' },
  { min: 60, max: 80, color: '#5cb85c', label: '60-80' },
  { min: 40, max: 60, color: '#ef9f27', label: '40-60' },
  { min: 20, max: 40, color: '#e57373', label: '20-40' },
  { min: 0, max: 20, color: '#e24b4a', label: '0-20' },
]

// SVG drawn in a 540×540 viewBox; consumer scales via container width.
const SIZE = 540

export default function PizzaChart({ data }: PizzaChartProps) {
  const numSlices = data.length
  const anglePerSlice = 360 / numSlices
  const center = SIZE / 2
  const maxRadius = (SIZE / 2) - 55
  const minRadius = 40

  const getRadius = (percentile: number) => {
    return minRadius + (maxRadius - minRadius) * (Math.max(0, Math.min(100, percentile)) / 100)
  }

  const generateSlicePath = (index: number, percentile: number) => {
    const startAngle = 90 - (index * anglePerSlice)
    const endAngle = startAngle - anglePerSlice
    const outerRadius = getRadius(percentile)

    const startRad = (startAngle * Math.PI) / 180
    const endRad = (endAngle * Math.PI) / 180

    const largeArc = anglePerSlice > 180 ? 1 : 0

    const outerX1 = center + maxRadius * Math.cos(startRad)
    const outerY1 = center - maxRadius * Math.sin(startRad)
    const outerX2 = center + maxRadius * Math.cos(endRad)
    const outerY2 = center - maxRadius * Math.sin(endRad)
    const innerX1 = center + minRadius * Math.cos(startRad)
    const innerY1 = center - minRadius * Math.sin(startRad)
    const innerX2 = center + minRadius * Math.cos(endRad)
    const innerY2 = center - minRadius * Math.sin(endRad)

    const fillX1 = center + outerRadius * Math.cos(startRad)
    const fillY1 = center - outerRadius * Math.sin(startRad)
    const fillX2 = center + outerRadius * Math.cos(endRad)
    const fillY2 = center - outerRadius * Math.sin(endRad)

    return {
      bgPath: `M ${outerX1} ${outerY1} A ${maxRadius} ${maxRadius} 0 ${largeArc} 0 ${outerX2} ${outerY2} L ${innerX2} ${innerY2} A ${minRadius} ${minRadius} 0 ${largeArc} 1 ${innerX1} ${innerY1} Z`,
      fillPath: `M ${fillX1} ${fillY1} A ${outerRadius} ${outerRadius} 0 ${largeArc} 0 ${fillX2} ${fillY2} L ${innerX2} ${innerY2} A ${minRadius} ${minRadius} 0 ${largeArc} 1 ${innerX1} ${innerY1} Z`,
    }
  }

  const getLabelPosition = (index: number) => {
    const midAngle = 90 - (index * anglePerSlice) - (anglePerSlice / 2)
    const rad = (midAngle * Math.PI) / 180
    const labelRadius = maxRadius + 28
    return {
      x: center + labelRadius * Math.cos(rad),
      y: center - labelRadius * Math.sin(rad),
    }
  }

  const getPctPosition = (index: number) => {
    const midAngle = 90 - (index * anglePerSlice) - (anglePerSlice / 2)
    const rad = (midAngle * Math.PI) / 180
    const radius = minRadius + (maxRadius - minRadius) * 0.55
    return {
      x: center + radius * Math.cos(rad),
      y: center - radius * Math.sin(rad),
    }
  }

  // Pad viewBox so labels rendered outside the slice ring aren't clipped.
  const padding = 60
  const viewBox = `${-padding} ${-padding} ${SIZE + padding * 2} ${SIZE + padding * 2}`

  return (
    <div className="flex w-full flex-col items-center gap-3">
      <div className="w-full max-w-[540px]">
        <svg
          viewBox={viewBox}
          className="block h-auto w-full"
          preserveAspectRatio="xMidYMid meet"
        >
          {/* Background slices */}
          {data.map((_, i) => {
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

          {/* Percentile values on slices */}
          {data.map((d, i) => {
            const pos = getPctPosition(i)
            return (
              <text
                key={`pct-${i}`}
                x={pos.x}
                y={pos.y}
                textAnchor="middle"
                dominantBaseline="middle"
                style={{ fontSize: 14, fill: 'white', fontWeight: 700 }}
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
                  fontSize: 13,
                  fill: d.inverted ? 'var(--muted-foreground)' : 'var(--foreground)',
                  fontWeight: 500,
                }}
              >
                {d.inverted ? `▼ ${d.label}` : d.label}
              </text>
            )
          })}
        </svg>
      </div>

      {/* Legend — gradient strip with min/max labels (compact) */}
      <div className="flex w-full max-w-[420px] items-center gap-2 text-[11px] text-muted-foreground">
        <span className="tabular-nums">0</span>
        <div
          className="h-2 flex-1 rounded-full"
          style={{
            background: `linear-gradient(to right, ${COLOR_RANGES[4].color} 0%, ${COLOR_RANGES[3].color} 25%, ${COLOR_RANGES[2].color} 50%, ${COLOR_RANGES[1].color} 75%, ${COLOR_RANGES[0].color} 100%)`,
          }}
        />
        <span className="tabular-nums">100</span>
      </div>
    </div>
  )
}
