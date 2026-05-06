import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { Skeleton } from '../components/ui/skeleton'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../components/ui/table'
import { Input } from '../components/ui/input'
import {
  getAllPlayers,
  getAllSeasons,
  getLeagues,
  getLeagueTeams,
  type LeaguePlayer,
} from '../lib/queries'
import { POSITION_GROUPS, getPositionGroupLabel, type PositionGroup } from '../lib/positions'
import type { League } from '../lib/types'
import { scoreConfidenceBand, scoreConfidenceLabel } from '../lib/utils'

export const Route = createFileRoute('/players')({ component: PlayersPage })

function PlayersPage() {
  const [allSeasons, setAllSeasons] = useState<string[]>([])
  const [leagues, setLeagues] = useState<League[]>([])
  const [teams, setTeams] = useState<{ id: number; name: string }[]>([])

  const [selectedSeason, setSelectedSeason] = useState('')
  const [selectedLeague, setSelectedLeague] = useState<number | null>(null)
  const [selectedPosition, setSelectedPosition] = useState<'All' | PositionGroup>('All')
  const [selectedClub, setSelectedClub] = useState<number | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  const [players, setPlayers] = useState<(LeaguePlayer & { league_name: string | null })[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([getAllSeasons(), getLeagues()]).then(([seasons, leagueList]) => {
      const seasonStrings = seasons.map((s) => s.season)
      setAllSeasons(seasonStrings)
      setLeagues(leagueList)
      if (seasonStrings.length > 0) setSelectedSeason(seasonStrings[0])
    })
  }, [])

  useEffect(() => {
    if (selectedLeague == null) {
      setTeams([])
      setSelectedClub(null)
      return
    }
    getLeagueTeams({ data: { leagueId: selectedLeague } }).then(setTeams)
    setSelectedClub(null)
  }, [selectedLeague])

  useEffect(() => {
    if (!selectedSeason) return
    setLoading(true)
    getAllPlayers({
      data: {
        season: selectedSeason,
        leagueId: selectedLeague ?? undefined,
        position: selectedPosition !== 'All' ? selectedPosition : undefined,
        clubId: selectedClub ?? undefined,
        search: searchQuery || undefined,
      },
    }).then((p) => {
      setPlayers(p)
      setLoading(false)
    })
  }, [selectedSeason, selectedLeague, selectedPosition, selectedClub, searchQuery])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Players</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {loading ? 'Loading…' : `${players.length} players`}
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search players…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <select
            value={selectedSeason}
            onChange={(e) => setSelectedSeason(e.target.value)}
            className="h-8 rounded-none border border-input bg-background px-2 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
          >
            {allSeasons.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>

          <select
            value={selectedLeague ?? ''}
            onChange={(e) => setSelectedLeague(e.target.value ? Number(e.target.value) : null)}
            className="h-8 rounded-none border border-input bg-background px-2 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
          >
            <option value="">All Leagues</option>
            {leagues.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>

          <select
            value={selectedPosition}
            onChange={(e) => setSelectedPosition(e.target.value as 'All' | PositionGroup)}
            className="h-8 rounded-none border border-input bg-background px-2 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
          >
            <option value="All">All Positions</option>
            {POSITION_GROUPS.map((p) => (
              <option key={p.value} value={p.value}>{getPositionGroupLabel(p.value)}</option>
            ))}
          </select>

          {teams.length > 0 && (
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
          )}
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 12 }).map((_, i) => (
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
                <TableHead className="hidden sm:table-cell">League</TableHead>
                <TableHead className="hidden md:table-cell">Club</TableHead>
                <TableHead className="hidden md:table-cell">Nationality</TableHead>
                <TableHead className="hidden lg:table-cell">Age</TableHead>
                <TableHead className="text-right">KnowBall Score</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {players.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
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
                    <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                      {player.league_name ?? '—'}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                      {player.club ?? '—'}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                      {player.nationality ?? '—'}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                      {player.age ?? '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      {player.model_score != null ? (
                        <div className="flex flex-col items-end gap-1">
                          <span className="inline-flex items-center justify-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">
                            {Number(player.model_score).toFixed(1)}
                          </span>
                          <span
                            className={
                              scoreConfidenceBand(player.model_score_confidence, player.rated_minutes) === 'limited'
                                ? 'text-[10px] font-semibold uppercase tracking-wide text-amber-600'
                                : scoreConfidenceBand(player.model_score_confidence, player.rated_minutes) === 'moderate'
                                  ? 'text-[10px] font-semibold uppercase tracking-wide text-muted-foreground'
                                  : 'text-[10px] font-semibold uppercase tracking-wide text-emerald-700'
                            }
                            title={`${Math.round(Number(player.model_score_confidence ?? 0))}% confidence · ${player.rated_minutes ?? 0} rated mins`}
                          >
                            {scoreConfidenceLabel(player.model_score_confidence, player.rated_minutes)}
                          </span>
                        </div>
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
