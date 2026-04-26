import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Skeleton } from '../components/ui/skeleton'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../components/ui/table'
import { Input } from '../components/ui/input'
import LeagueTabs from '../components/LeagueTabs'
import {
  getLeagues,
  getLeaguePlayers,
  getLeagueSeasons,
  getLeagueTeams,
  getLeaguePositions,
  type LeaguePlayer,
} from '../lib/queries'
import { getPositionGroupLabel, type PositionGroup } from '../lib/positions'
import type { League } from '../lib/types'
import { Search, ArrowLeft } from 'lucide-react'

export const Route = createFileRoute('/league/$id')({ component: LeagueOverviewPage })

function LeagueOverviewPage() {
  const { id } = Route.useParams()
  const [leagues, setLeagues] = useState<League[]>([])
  const [activeLeague, setActiveLeague] = useState(Number(id))

  const [seasons, setSeasons] = useState<string[]>([])
  const [activeSeason, setActiveSeason] = useState('2025/2026')
  const [teams, setTeams] = useState<{ id: number; name: string }[]>([])
  const [positions, setPositions] = useState<{ value: PositionGroup; label: string }[]>([])

  const [searchQuery, setSearchQuery] = useState('')
  const [selectedPosition, setSelectedPosition] = useState<'All' | PositionGroup>('All')
  const [selectedClub, setSelectedClub] = useState<number | null>(null)

  const [players, setPlayers] = useState<LeaguePlayer[]>([])
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
      getLeagueSeasons({ data: { leagueId: activeLeague } }),
      getLeagueTeams({ data: { leagueId: activeLeague } }),
      getLeaguePositions({ data: { leagueId: activeLeague, season: activeSeason } }),
    ]).then(([s, t, p]) => {
      setSeasons(s.map((r) => r.season))
      setTeams(t)
      setPositions(p)
    })
  }, [activeLeague])

  useEffect(() => {
    if (!activeLeague) return
    setLoading(true)
    getLeaguePlayers({
      data: {
        leagueId: activeLeague,
        season: activeSeason,
        search: searchQuery || undefined,
        position: selectedPosition !== 'All' ? selectedPosition : undefined,
        clubId: selectedClub ?? undefined,
      },
    }).then((p) => {
      setPlayers(p)
      setLoading(false)
    })
  }, [activeLeague, activeSeason, searchQuery, selectedPosition, selectedClub])

  useEffect(() => {
    if (!activeLeague) return
    getLeaguePositions({ data: { leagueId: activeLeague, season: activeSeason } }).then((nextPositions) => {
      setPositions(nextPositions)
      if (selectedPosition !== 'All' && !nextPositions.some((position) => position.value === selectedPosition)) {
        setSelectedPosition('All')
      }
    })
  }, [activeLeague, activeSeason])

  const currentLeague = leagues.find((l) => l.id === activeLeague)

  return (
    <div className="space-y-6">
      <div>
        <button onClick={() => window.history.back()} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-2">
          <ArrowLeft size={14} /> Back
        </button>
        <h1 className="text-2xl font-bold tracking-tight">{currentLeague?.name ?? 'League'}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{players.length} players tracked</p>
      </div>

      {leagues.length > 0 && (
        <LeagueTabs leagues={leagues} activeId={activeLeague} onChange={setActiveLeague} />
      )}

      {/* Filters */}
      <div className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search players..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <select
              value={activeSeason}
              onChange={(e) => setActiveSeason(e.target.value)}
              className="h-8 rounded-none border border-input bg-background px-2 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
            >
              {seasons.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>

            <select
              value={selectedPosition}
              onChange={(e) => setSelectedPosition(e.target.value as 'All' | PositionGroup)}
              className="h-8 rounded-none border border-input bg-background px-2 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
            >
              <option value="All">All Positions</option>
              {positions.map((p) => (
                <option key={p.value} value={p.value}>{getPositionGroupLabel(p.value)}</option>
              ))}
            </select>

            <select
              value={selectedClub ?? ''}
              onChange={(e) => setSelectedClub(e.target.value ? Number(e.target.value) : null)}
              className="h-8 rounded-none border border-input bg-background px-2 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
            >
              <option value="">All Clubs</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Players Table */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className="h-10 rounded" />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Position</TableHead>
                <TableHead>Nationality</TableHead>
                <TableHead>Age</TableHead>
                <TableHead>Club</TableHead>
                <TableHead className="text-right">KnowBall Score</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {players.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    No players found
                  </TableCell>
                </TableRow>
              ) : (
                players.map((player) => (
                  <TableRow key={player.id}>
                    <TableCell>
                      <Link
                        to="/player/$id"
                        params={{ id: String(player.id) }}
                        className="text-sm font-medium text-foreground no-underline hover:text-primary"
                      >
                        {player.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {player.position ?? '—'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {player.nationality ?? '—'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {player.age ?? '—'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {player.club ?? '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      {player.model_score !== null ? (
                        <span className="inline-flex items-center justify-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">
                          {Number(player.model_score).toFixed(1)}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
