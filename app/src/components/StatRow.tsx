interface StatRowProps {
  label: string
  value: string
  percentile: number
}

export default function StatRow({ label, value, percentile }: StatRowProps) {
  const pct = Math.min(100, Math.max(0, percentile))
  const fillColor = pct >= 70 ? '#1d9e75' : pct >= 40 ? '#ef9f27' : '#e24b4a'
  const barWidth = Math.max(pct, 8)

  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
        <span style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>{label}</span>
        <span style={{ fontSize: 11, fontWeight: 500, color: fillColor }}>{Math.round(pct)}</span>
      </div>
      <div style={{ height: 22, background: 'var(--muted)', borderRadius: 4, overflow: 'hidden', position: 'relative' }}>
        <div
          style={{
            height: '100%',
            width: `${barWidth}%`,
            background: fillColor,
            borderRadius: 4,
            display: 'flex',
            alignItems: 'center',
            paddingLeft: 8,
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 600, color: 'white' }}>{value}</span>
        </div>
      </div>
    </div>
  )
}