import { cn } from '../lib/utils'

interface TrendingPlayerCardProps {
  playerName: string
  teamName: string
  rating: number
  rank: number
}

export default function TrendingPlayerCard({ playerName, teamName, rating, rank }: TrendingPlayerCardProps) {
  const ratingFloor = Math.floor(rating)

  return (
    <div className="flex items-center gap-4 rounded-xl border border-border bg-card p-4 transition-all hover:bg-accent/30">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-sm font-bold text-primary">
        {rank}
      </span>
      
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-foreground truncate">{playerName}</div>
        {teamName && <div className="text-xs text-muted-foreground truncate">{teamName}</div>}
      </div>

      <div className="flex gap-0.5 shrink-0">
        {Array.from({ length: 10 }).map((_, i) => (
          <div
            key={i}
            className={cn(
              "h-2.5 w-1.5 rounded-sm transition-colors",
              i < ratingFloor ? "bg-primary" : "bg-muted/50"
            )}
          />
        ))}
      </div>

      <div className="text-xl font-bold text-primary shrink-0 w-12 text-right">
        {rating.toFixed(2)}
      </div>
    </div>
  )
}