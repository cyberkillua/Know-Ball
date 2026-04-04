import { cn } from '../lib/utils'

function getRatingColor(rating: number): string {
  if (rating >= 8.0) return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
  if (rating >= 7.0) return 'bg-green-500/20 text-green-400 border-green-500/30'
  if (rating >= 6.5) return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
  if (rating >= 5.5) return 'bg-orange-500/20 text-orange-400 border-orange-500/30'
  return 'bg-red-500/20 text-red-400 border-red-500/30'
}

export default function RatingBadge({
  rating,
  size = 'md',
  className,
}: {
  rating: number
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  const sizeClasses = {
    sm: 'text-xs px-1.5 py-0.5',
    md: 'text-sm px-2 py-1',
    lg: 'text-lg px-3 py-1.5 font-bold',
  }

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-none border font-semibold tabular-nums',
        getRatingColor(rating),
        sizeClasses[size],
        className,
      )}
    >
      {rating.toFixed(2)}
    </span>
  )
}
