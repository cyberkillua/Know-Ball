import { Link } from '@tanstack/react-router'
import RatingBadge from './RatingBadge'
import { MiniCategoryBarsLabeled } from './MiniCategoryBars'

interface Props {
  playerId: number
  playerName: string
  position?: string
  rating: number
  finishing: number
  involvement: number
  carrying: number
  physical: number
  pressing: number
}

export default function MotmCard({
  playerId,
  playerName,
  position,
  rating,
  finishing,
  involvement,
  carrying,
  physical,
  pressing,
}: Props) {
  return (
    <div className="card-glow-gold rounded-none border border-amber-500/20 bg-gradient-to-br from-amber-500/5 to-card p-5">
      <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-amber-400">
        Man of the Match
      </div>
      <div className="flex items-start gap-4">
        <div className="flex-1">
          <Link
            to="/player/$id"
            params={{ id: String(playerId) }}
            className="text-lg font-bold text-foreground no-underline hover:text-primary"
          >
            {playerName}
          </Link>
          {position && <div className="text-xs text-muted-foreground">{position}</div>}
          <div className="mt-3">
            <MiniCategoryBarsLabeled
              finishing={finishing}
              involvement={involvement}
              carrying={carrying}
              physical={physical}
              pressing={pressing}
            />
          </div>
        </div>
        <RatingBadge rating={rating} size="lg" />
      </div>
    </div>
  )
}
