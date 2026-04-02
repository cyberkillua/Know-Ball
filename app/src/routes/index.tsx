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
  getTopRatedByMatchday,
  getLatestMatchday,
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
        const [leaguesData, playerCounts, total, latestMatchdayData] = await Promise.all([
          getLeagues(),
          getLeaguePlayerCounts(),
          getTotalPlayerCount(),
          getLeagues().then((l) => {
            if (l.length > 0) {
              return getLatestMatchday({ data: { leagueId: l[0].id, season: CURRENT_SEASON } })
            }
            return null
          }),
        ])

        const countsMap = new Map(playerCounts.map((c) => [c.league_id, c.player_count]))
        const leaguesWithCounts = leaguesData.map((league) => ({
          ...league,
          player_count: countsMap.get(league.id),
        }))
        setLeagues(leaguesWithCounts)
        setTotalPlayers(total)

        if (latestMatchdayData && leaguesData.length > 0) {
          const ratings = await getTopRatedByMatchday({
            data: { leagueId: leaguesData[0].id, season: CURRENT_SEASON, matchday: latestMatchdayData },
          })
          setTopRated(ratings as PlayerRating[])
        }
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

      {/* Trending Players */}
      <section className="space-y-3">
        <h2 className="text-xl font-bold">Trending Players</h2>
        <p className="text-sm text-muted-foreground">
          Top rated from latest matchday
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
                teamName=""
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