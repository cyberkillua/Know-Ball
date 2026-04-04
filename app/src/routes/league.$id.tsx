import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Skeleton } from '../components/ui/skeleton'
import RatingBadge from '../components/RatingBadge'
import MiniCategoryBars from '../components/MiniCategoryBars'
import CategoryKingCard from '../components/CategoryKingCard'
import StatCard from '../components/StatCard'
import LeagueTabs from '../components/LeagueTabs'
import {
  getLeagues,
  getLeagueTopPlayers,
  getLeagueStats,
  getLeagueCategoryLeaders,
} from '../lib/queries'
import type { League, PeerRating } from '../lib/types'
import { Trophy, Users, TrendingUp, Zap, Target } from 'lucide-react'

export const Route = createFileRoute('/league/$id')({ component: LeagueOverviewPage })

const CURRENT_SEASON = '2025/2026'

function LeagueOverviewPage() {
  const { id } = Route.useParams()
  const [leagues, setLeagues] = useState<League[]>([])
  const [activeLeague, setActiveLeague] = useState(Number(id))
  const [players, setPlayers] = useState<(PeerRating & { player?: any })[]>([])
  const [leagueStats, setLeagueStats] = useState<any>(null)
  const [categoryLeaders, setCategoryLeaders] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getLeagues().then(setLeagues)
  }, [])

  useEffect(() => {
    setActiveLeague(Number(id))
  }, [id])

  useEffect(() => {
    if (!activeLeague) return
    setLoading(true)
    Promise.all([
      getLeagueTopPlayers({ data: { leagueId: activeLeague, season: CURRENT_SEASON } }),
      getLeagueStats({ data: { leagueId: activeLeague, season: CURRENT_SEASON } }),
      getLeagueCategoryLeaders({ data: { leagueId: activeLeague, season: CURRENT_SEASON } }),
    ]).then(([p, s, cl]) => {
      setPlayers(p as any)
      setLeagueStats(s)
      setCategoryLeaders(cl as any)
      setLoading(false)
    })
  }, [activeLeague])

  const currentLeague = leagues.find((l) => l.id === activeLeague)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{currentLeague?.name ?? 'League'} Overview</h1>
        <p className="mt-1 text-sm text-muted-foreground">{CURRENT_SEASON} · Striker Ratings</p>
      </div>

      {leagues.length > 0 && (
        <LeagueTabs leagues={leagues} activeId={activeLeague} onChange={setActiveLeague} />
      )}

      {loading ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
          </div>
          <Skeleton className="h-64 rounded-xl" />
        </div>
      ) : (
        <>
          {/* Stats Dashboard */}
          {leagueStats && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                label="Matches Played"
                value={leagueStats.matches_played ?? 0}
                icon={<Trophy size={16} />}
              />
              <StatCard
                label="Total Goals"
                value={leagueStats.total_goals ?? 0}
                icon={<Target size={16} />}
                color="var(--cat-finishing)"
              />
              <StatCard
                label="Avg ST Rating"
                value={Number(leagueStats.avg_rating ?? 0).toFixed(2)}
                icon={<TrendingUp size={16} />}
                color="var(--cat-involvement)"
              />
              <StatCard
                label="Highest Rating"
                value={Number(leagueStats.highest_rating ?? 0).toFixed(2)}
                icon={<Zap size={16} />}
                color="var(--cat-carrying)"
              />
            </div>
          )}

          {/* Category Leaders */}
          {categoryLeaders.length > 0 && (
            <div>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Season Category Leaders
              </h2>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                {categoryLeaders.map((leader: any) => (
                  <CategoryKingCard
                    key={leader.category}
                    category={leader.category}
                    playerName={leader.player_name}
                    playerId={leader.player_id}
                    score={Number(leader.score)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Top Rated Strikers */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users size={18} /> Top Rated Strikers
              </CardTitle>
            </CardHeader>
            <CardContent>
              {players.length > 0 ? (
                <div className="space-y-2">
                  {players.map((p, i) => (
                    <div
                      key={p.id}
                      className="card-glow flex items-center gap-3 rounded-lg border border-border bg-card/50 p-3"
                    >
                      <span
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                          i === 0
                            ? 'bg-amber-500/20 text-amber-400'
                            : i === 1
                              ? 'bg-gray-400/20 text-gray-300'
                              : i === 2
                                ? 'bg-orange-500/20 text-orange-400'
                                : 'bg-secondary text-muted-foreground'
                        }`}
                      >
                        {i + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <Link
                          to="/player/$id"
                          params={{ id: String(p.player_id) }}
                          className="text-sm font-semibold text-foreground no-underline hover:text-primary"
                        >
                          {p.player?.name ?? `Player ${p.player_id}`}
                        </Link>
                        <div className="text-xs text-muted-foreground">
                          {p.player?.team?.name ?? ''} · {p.matches_played} matches
                        </div>
                      </div>
                      <div className="hidden sm:block">
                        <MiniCategoryBars
                          finishing={Number(p.finishing_percentile ?? 0) / 10}
                          involvement={Number(p.involvement_percentile ?? 0) / 10}
                          carrying={Number(p.carrying_percentile ?? 0) / 10}
                          physical={Number(p.physical_percentile ?? 0) / 10}
                          pressing={Number(p.pressing_percentile ?? 0) / 10}
                          mode="pct"
                        />
                      </div>
                      <RatingBadge rating={Number(p.avg_match_rating)} />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No data available yet.</p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
