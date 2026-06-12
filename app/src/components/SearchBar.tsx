import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { Input } from './ui/input'
import { searchPlayers, searchTeams } from '../lib/queries'
import type { Player, TeamSearchResult } from '../lib/types'

export default function SearchBar({ onSelect }: { onSelect?: () => void }) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [players, setPlayers] = useState<Player[]>([])
  const [teams, setTeams] = useState<TeamSearchResult[]>([])
  const [loading, setLoading] = useState(false)

  async function handleSearch(value: string) {
    setQuery(value)
    if (value.length < 2) {
      setPlayers([])
      setTeams([])
      return
    }
    setLoading(true)
    try {
      const [p, t] = await Promise.all([
        searchPlayers({ data: { query: value } }),
        searchTeams({ data: { query: value } }),
      ])
      setPlayers(p)
      setTeams(t)
    } catch {
      setPlayers([])
      setTeams([])
    } finally {
      setLoading(false)
    }
  }

  function reset() {
    setQuery('')
    setPlayers([])
    setTeams([])
    onSelect?.()
  }

  function goToPlayer(playerId: number) {
    reset()
    navigate({ to: '/player/$id', params: { id: String(playerId) } })
  }

  function goToTeam(teamId: number) {
    reset()
    navigate({ to: '/team/$id', params: { id: String(teamId) } })
  }

  const hasResults = players.length > 0 || teams.length > 0

  return (
    <div className="relative">
      <Input
        placeholder="Search players or teams..."
        value={query}
        onChange={(e) => handleSearch(e.target.value)}
        className="bg-secondary"
      />
      {hasResults && (
        <div className="absolute top-full z-50 mt-1 w-full overflow-hidden rounded-md border border-border bg-card shadow-lg">
          {teams.length > 0 && (
            <>
              <div className="bg-secondary/60 px-3 py-1 text-xs font-medium text-muted-foreground">
                Teams
              </div>
              {teams.map((team) => (
                <button
                  key={`team-${team.id}`}
                  onClick={() => goToTeam(team.id)}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-accent"
                >
                  <div>
                    <div className="font-medium text-foreground">{team.name}</div>
                    <div className="text-xs text-muted-foreground">{team.league_name}</div>
                  </div>
                </button>
              ))}
            </>
          )}
          {players.length > 0 && (
            <>
              <div className="bg-secondary/60 px-3 py-1 text-xs font-medium text-muted-foreground">
                Players
              </div>
              {players.map((player) => (
                <button
                  key={`player-${player.id}`}
                  onClick={() => goToPlayer(player.id)}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-accent"
                >
                  <div>
                    <div className="font-medium text-foreground">{player.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {player.position} · {(player.team as any)?.name ?? 'Unknown'}
                    </div>
                  </div>
                </button>
              ))}
            </>
          )}
        </div>
      )}
      {loading && !hasResults && (
        <div className="absolute top-full z-50 mt-1 w-full rounded-md border border-border bg-card p-3 text-center text-sm text-muted-foreground shadow-lg">
          Searching...
        </div>
      )}
    </div>
  )
}
