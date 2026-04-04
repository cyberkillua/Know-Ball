interface Props {
  label: string
  value: string | number
  sub?: string
  color?: string
  icon?: React.ReactNode
}

export default function StatCard({ label, value, sub, color, icon }: Props) {
  return (
    <div className="card-glow rounded-none border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        {icon && <div className="text-muted-foreground">{icon}</div>}
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
      </div>
      <div className="mt-1 text-2xl font-bold tabular-nums" style={color ? { color } : undefined}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </div>
  )
}
