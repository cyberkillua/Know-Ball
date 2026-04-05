interface StatRowProps {
  label: string
  value: string
  percentile?: number
}

export default function StatRow({ label, value, percentile }: StatRowProps) {
  if (percentile === undefined) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 11, color: 'var(--muted-foreground)', whiteSpace: 'nowrap', width: 160, flexShrink: 0, textAlign: 'right' }}>{label}</span>
        <div style={{ flex: 1, height: 18, background: 'var(--muted)', borderRadius: 4, display: 'flex', alignItems: 'center', paddingLeft: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--foreground)' }}>{value}</span>
        </div>
        <span style={{ width: 24, flexShrink: 0 }} />
      </div>
    )
  }

  const pct = Math.min(100, Math.max(0, percentile))
  const fillColor = pct >= 70 ? '#1d9e75' : pct >= 40 ? '#ef9f27' : '#e24b4a'
  const barWidth = Math.max(pct, 8)

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
      <span style={{ fontSize: 11, color: 'var(--muted-foreground)', whiteSpace: 'nowrap', width: 160, flexShrink: 0, textAlign: 'right' }}>{label}</span>
      <div style={{ flex: 1, height: 18, background: 'var(--muted)', borderRadius: 4, overflow: 'hidden', position: 'relative' }}>
        <div
          style={{
            height: '100%',
            width: `${barWidth}%`,
            background: fillColor,
            borderRadius: 4,
            display: 'flex',
            alignItems: 'center',
            paddingLeft: 6,
          }}
        >
          <span style={{ fontSize: 11, fontWeight: 600, color: 'white' }}>{value}</span>
        </div>
      </div>
      <span style={{ fontSize: 11, fontWeight: 500, color: fillColor, width: 24, textAlign: 'right', flexShrink: 0 }}>{Math.round(pct)}</span>
    </div>
  )
}
