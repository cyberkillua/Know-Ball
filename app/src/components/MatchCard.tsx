import { Link } from '@tanstack/react-router'
import { Card, CardContent } from './ui/card'
import RatingBadge from './RatingBadge'
import type { Match, MatchRating } from '../lib/types'

export default function MatchCard({
  match,
  topRating,
}: {
  match: Match
  topRating?: MatchRating & { player?: { name: string } }
}) {
  return (
    <Link to="/match/$id" params={{ id: String(match.id) }} className="no-underline">
      <Card className="transition-colors hover:bg-accent/50">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-foreground">
                  {match.home_team?.name ?? 'Home'}
                </span>
                <span className="tabular-nums font-bold text-foreground">
                  {match.home_score}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between text-sm">
                <span className="font-medium text-foreground">
                  {match.away_team?.name ?? 'Away'}
                </span>
                <span className="tabular-nums font-bold text-foreground">
                  {match.away_score}
                </span>
              </div>
            </div>
          </div>

          {topRating && (
            <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
              <span className="text-xs text-muted-foreground">
                Top: {topRating.player?.name}
              </span>
              <RatingBadge rating={topRating.final_rating} size="sm" />
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  )
}
