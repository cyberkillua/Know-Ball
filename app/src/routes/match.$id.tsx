import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Skeleton } from '../components/ui/skeleton'
import RatingBadge from '../components/RatingBadge'
import MotmCard from '../components/MotmCard'
import TeamComparisonBars from '../components/TeamComparisonBars'
import { MiniCategoryBarsLabeled } from '../components/MiniCategoryBars'
import { getMatch, getMatchRatings, getMatchStats } from '../lib/queries'
import type { Match, MatchRating } from '../lib/types'

export const Route = createFileRoute('/match/$id')({ component: MatchDetailPage })

function MatchDetailPage() {
  const { id } = Route.useParams()
  const [match, setMatch] = useState<Match | null>(null)
  const [ratings, setRatings] = useState<MatchRating[]>([])
  const [teamStats, setTeamStats] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const matchId = Number(id)
    Promise.all([
      getMatch({ data: { matchId } }),
      getMatchRatings({ data: { matchId } }),
      getMatchStats({ data: { matchId } }),
    ]).then(([m, r, ts]) => {
      setMatch(m)
      setRatings(r)
      setTeamStats(ts as any)
      setLoading(false)
    })
  }, [id])

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-28 rounded-xl" />
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-64 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      </div>
    )
  }

  if (!match) {
    return <div className="text-muted-foreground">Match not found.</div>
  }

  const motm = ratings.length > 0 ? ratings[0] : null
  const homeStats = teamStats.find((t: any) => t.team_id === match.home_team_id)
  const awayStats = teamStats.find((t: any) => t.team_id === match.away_team_id)

  const comparisonStats = homeStats && awayStats ? [
    { label: 'Shots', homeVal: homeStats.shots ?? 0, awayVal: awayStats.shots ?? 0 },
    { label: 'On Target', homeVal: homeStats.shots_on_target ?? 0, awayVal: awayStats.shots_on_target ?? 0 },
    { label: 'xG', homeVal: Number(homeStats.xg ?? 0), awayVal: Number(awayStats.xg ?? 0), format: (v: number) => v.toFixed(2) },
    { label: 'Passes', homeVal: homeStats.passes_completed ?? 0, awayVal: awayStats.passes_completed ?? 0 },
    { label: 'Tackles', homeVal: homeStats.tackles ?? 0, awayVal: awayStats.tackles ?? 0 },
    { label: 'Aerials Won', homeVal: homeStats.aerials_won ?? 0, awayVal: awayStats.aerials_won ?? 0 },
    { label: 'Dribbles', homeVal: homeStats.dribbles ?? 0, awayVal: awayStats.dribbles ?? 0 },
  ] : []

  return (
    <div className="space-y-6">
      {/* Score header */}
      <Card>
        <CardContent className="p-6">
          <div className="text-center">
            <div className="mb-2 text-xs text-muted-foreground">
              {match.season} · Matchday {match.matchday}
            </div>
            <div className="flex items-center justify-center gap-6">
              <div className="text-right flex-1">
                <div className="text-lg font-bold">{(match.home_team as any)?.name}</div>
              </div>
              <div className="flex items-center gap-3">
                <span className={`text-4xl font-extrabold tabular-nums ${Number(match.home_score) > Number(match.away_score) ? 'text-foreground' : 'text-muted-foreground'}`}>
                  {match.home_score}
                </span>
                <span className="text-xl text-muted-foreground">-</span>
                <span className={`text-4xl font-extrabold tabular-nums ${Number(match.away_score) > Number(match.home_score) ? 'text-foreground' : 'text-muted-foreground'}`}>
                  {match.away_score}
                </span>
              </div>
              <div className="text-left flex-1">
                <div className="text-lg font-bold">{(match.away_team as any)?.name}</div>
              </div>
            </div>
            <div className="mt-2 text-xs text-muted-foreground">{match.date}</div>
          </div>
        </CardContent>
      </Card>

      {/* MOTM + Team Stats row */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Man of the Match */}
        {motm && (
          <MotmCard
            playerId={motm.player_id}
            playerName={(motm as any).player?.name ?? `Player ${motm.player_id}`}
            position={motm.position ?? undefined}
            rating={Number(motm.final_rating)}
            finishing={Number(motm.finishing_norm)}
            involvement={Number(motm.involvement_norm)}
            carrying={Number(motm.carrying_norm)}
            physical={Number(motm.physical_norm)}
            pressing={Number(motm.pressing_norm)}
          />
        )}

        {/* Team Comparison */}
        {comparisonStats.length > 0 && (
          <Card>
            <CardHeader><CardTitle>Team Stats</CardTitle></CardHeader>
            <CardContent>
              <TeamComparisonBars
                homeName={(match.home_team as any)?.name ?? 'Home'}
                awayName={(match.away_team as any)?.name ?? 'Away'}
                stats={comparisonStats}
              />
            </CardContent>
          </Card>
        )}
      </div>

      {/* Player Ratings */}
      <Card>
        <CardHeader>
          <CardTitle>Player Ratings</CardTitle>
        </CardHeader>
        <CardContent>
          {ratings.length > 0 ? (
            <div className="space-y-3">
              {ratings.map((r) => (
                <div
                  key={r.id}
                  className="card-glow flex items-center gap-3 rounded-lg border border-border bg-card/50 p-3"
                >
                  <RatingBadge rating={Number(r.final_rating)} />
                  <div className="flex-1 min-w-0">
                    <Link
                      to="/player/$id"
                      params={{ id: String(r.player_id) }}
                      className="text-sm font-semibold text-foreground no-underline hover:text-primary"
                    >
                      {(r as any).player?.name ?? `Player ${r.player_id}`}
                    </Link>
                    <div className="text-xs text-muted-foreground">{r.position}</div>
                  </div>
                  <div className="hidden sm:block w-48">
                    <MiniCategoryBarsLabeled
                      finishing={Number(r.finishing_norm)}
                      involvement={Number(r.involvement_norm)}
                      carrying={Number(r.carrying_norm)}
                      physical={Number(r.physical_norm)}
                      pressing={Number(r.pressing_norm)}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No ratings available for this match yet.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
