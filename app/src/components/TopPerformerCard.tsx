import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import RatingBadge from './RatingBadge'
import MiniCategoryBars from './MiniCategoryBars'
import MatchPerformanceDetail from './MatchPerformanceDetail'
import { getPlayerMatchStats } from '../lib/queries'
import type { MatchPlayerStats } from '../lib/types'

interface Props {
  rank: number
  playerId: number
  matchId: number
  playerName: string
  teamName?: string
  matchContext?: string
  rating: number
  finishing: number
  involvement: number
  carrying: number
  physical: number
  pressing: number
  isExpanded: boolean
  onToggle: () => void
}

export default function TopPerformerCard({
  rank,
  playerId,
  matchId,
  playerName,
  teamName,
  matchContext,
  rating,
  finishing,
  involvement,
  carrying,
  physical,
  pressing,
  isExpanded,
  onToggle,
}: Props) {
  const [matchStats, setMatchStats] = useState<MatchPlayerStats | null>(null)
  const [loading, setLoading] = useState(false)

  const isTop3 = rank <= 3

  async function handleToggle() {
    if (!isExpanded && !matchStats) {
      setLoading(true)
      try {
        const stats = await getPlayerMatchStats({ data: { playerId, matchId } })
        setMatchStats(stats as MatchPlayerStats | null)
      } catch {
        // silently fail — expanded section just won't show stats
      } finally {
        setLoading(false)
      }
    }
    onToggle()
  }

  return (
    <div
      className={`${isTop3 ? 'card-glow-gold' : 'card-glow'} rounded-xl border border-border bg-card transition-all ${isExpanded ? 'ring-1 ring-primary/30' : ''}`}
    >
      <button
        onClick={handleToggle}
        className="group flex w-full items-center gap-3 p-3 text-left transition-all hover:bg-accent/30 rounded-xl"
      >
        <div
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
            rank === 1
              ? 'bg-amber-500/20 text-amber-400'
              : rank === 2
                ? 'bg-gray-400/20 text-gray-300'
                : rank === 3
                  ? 'bg-orange-500/20 text-orange-400'
                  : 'bg-secondary text-muted-foreground'
          }`}
        >
          {rank}
        </div>

        <div className="flex-1 min-w-0">
          <div className="font-semibold text-foreground group-hover:text-primary transition-colors truncate">
            {playerName}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {teamName && <span>{teamName}</span>}
            {matchContext && (
              <>
                <span>·</span>
                <span>{matchContext}</span>
              </>
            )}
          </div>
        </div>

        <MiniCategoryBars
          finishing={finishing}
          involvement={involvement}
          carrying={carrying}
          physical={physical}
          pressing={pressing}
        />

        <RatingBadge rating={rating} size="lg" />

        <ChevronDown
          size={16}
          className={`shrink-0 text-muted-foreground transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
        />
      </button>

      {isExpanded && (
        <div className="px-3 pb-3">
          {loading ? (
            <div className="flex items-center justify-center py-6">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : matchStats ? (
            <MatchPerformanceDetail
              stats={matchStats}
              playerId={playerId}
              playerName={playerName}
              categories={{ finishing, involvement, carrying, physical, pressing }}
            />
          ) : (
            <div className="border-t border-border pt-3 text-center text-xs text-muted-foreground">
              No detailed stats available for this match.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
