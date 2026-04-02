import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { searchPlayers } from '../lib/queries'
import type { Player } from '../lib/types'

interface HeroSearchProps {
  playerCount?: number
  leagueCount?: number
}

export default function HeroSearch({ playerCount, leagueCount }: HeroSearchProps) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Player[]>([])
  const [loading, setLoading] = useState(false)

  async function handleSearch(value: string) {
    setQuery(value)
    if (value.length < 2) {
      setResults([])
      return
    }
    setLoading(true)
    try {
      const players = await searchPlayers({ data: { query: value } })
      setResults(players)
    } catch {
      setResults([])
    } finally {
      setLoading(false)
    }
  }

  function handleSelect(playerId: number) {
    setQuery('')
    setResults([])
    navigate({ to: '/player/$id', params: { id: String(playerId) } })
  }

  return (
    <section className="relative mx-auto max-w-2xl px-4 py-8 text-center md:py-10">
      <p className="text-muted-foreground mb-4">
        Search any player to see their ratings
      </p>
      <div className="relative mt-2">
        <input
          type="text"
          placeholder="Search for a player..."
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
          className="w-full rounded-xl border border-border bg-card px-4 py-3 text-base text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
        />

        {loading && (
          <div className="absolute top-full left-0 right-0 z-10 mt-2 rounded-xl border border-border bg-card p-4 text-center text-sm text-muted-foreground shadow-lg">
            Searching...
          </div>
        )}

        {results.length > 0 && (
          <div className="absolute top-full left-0 right-0 z-10 mt-2 rounded-xl border border-border bg-card shadow-lg overflow-hidden">
            {results.map((player) => (
              <button
                key={player.id}
                onClick={() => handleSelect(player.id)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-accent transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-foreground truncate">{player.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {player.position} · {(player.team as any)?.name ?? 'Unknown'}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {(playerCount !== undefined || leagueCount !== undefined) && (
        <p className="mt-6 text-sm text-muted-foreground">
          {playerCount !== undefined && (
            <span>{playerCount.toLocaleString()} players</span>
          )}
          {playerCount !== undefined && leagueCount !== undefined && (
            <span className="mx-2">·</span>
          )}
          {leagueCount !== undefined && (
            <span>{leagueCount} competitions</span>
          )}
        </p>
      )}
    </section>
  )
}