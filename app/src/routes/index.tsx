import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Skeleton } from '../components/ui/skeleton'
import HeroSearch from '../components/HeroSearch'
import LeagueCard from '../components/LeagueCard'
import TrendingPlayerCard from '../components/TrendingPlayerCard'
import {
  getLeagues,
  getLeaguePlayerCounts,
  getTotalPlayerCount,
  getTopRatedFromLatestMatchdays,
} from '../lib/queries'
import type { League, MatchRating } from '../lib/types'

export const Route = createFileRoute('/')({ component: LandingPage })

const CURRENT_SEASON = '2025/2026'

interface LeagueWithCount extends League {
  player_count?: number
}

interface PlayerRating extends MatchRating {
  player?: { id: number; name: string; position: string | null }
  match?: {
    id: number
    home_score: number | null
    away_score: number | null
    home_team?: { name: string }
    away_team?: { name: string }
  }
  league?: { id: number; name: string }
}

function LandingPage() {
  const [leagues, setLeagues] = useState<LeagueWithCount[]>([])
  const [topRated, setTopRated] = useState<PlayerRating[]>([])
  const [totalPlayers, setTotalPlayers] = useState<number>(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchData() {
      setLoading(true)
      try {
        const [leaguesData, playerCounts, total, ratings] = await Promise.all([
          getLeagues(),
          getLeaguePlayerCounts(),
          getTotalPlayerCount(),
          getTopRatedFromLatestMatchdays({ data: { season: CURRENT_SEASON, limit: 10 } }),
        ])

        const countsMap = new Map(playerCounts.map((c) => [c.league_id, c.player_count]))
        const leaguesWithCounts = leaguesData.map((league) => ({
          ...league,
          player_count: countsMap.get(league.id),
        }))
        setLeagues(leaguesWithCounts)
        setTotalPlayers(total)
        setTopRated(ratings as PlayerRating[])
      } catch (error) {
        console.error('Failed to fetch data:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [])

  return (
    <div className="space-y-6 pb-20">
      <HeroSearch playerCount={totalPlayers} leagueCount={leagues.length} />

      {/* Competitions */}
      <section className="space-y-3">
        <h2 className="text-xl font-bold">Competitions</h2>
        <p className="text-sm text-muted-foreground">
          {leagues.length} competitions live
        </p>

        {loading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {leagues.map((league) => (
              <LeagueCard
                key={league.id}
                league={league}
                playerCount={league.player_count}
              />
            ))}
          </div>
        )}
      </section>

      {/* Latest Matchday Standouts */}
      <section className="space-y-3">
        <h2 className="text-xl font-bold">Latest Matchday Standouts</h2>
        <p className="text-sm text-muted-foreground">
          Top rated from each competition's latest matchday
        </p>

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 10 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
        ) : topRated.length > 0 ? (
          <div className="space-y-3">
            {topRated.slice(0, 10).map((player, i) => (
              <TrendingPlayerCard
                key={player.id}
                rank={i + 1}
                playerName={player.player?.name ?? `Player ${player.player_id}`}
                teamName={[player.player?.position, player.league?.name].filter(Boolean).join(' - ')}
                rating={Number(player.final_rating)}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card p-8 text-center text-muted-foreground">
            No ratings available for the latest matchday.
          </div>
        )}
      </section>
    </div>
  )
}
