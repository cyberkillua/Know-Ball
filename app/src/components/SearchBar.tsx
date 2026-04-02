import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { Input } from './ui/input'
import { searchPlayers } from '../lib/queries'
import type { Player } from '../lib/types'

export default function SearchBar({ onSelect }: { onSelect?: () => void }) {
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
    onSelect?.()
    navigate({ to: '/player/$id', params: { id: String(playerId) } })
  }

  return (
    <div className="relative">
      <Input
        placeholder="Search players..."
        value={query}
        onChange={(e) => handleSearch(e.target.value)}
        className="bg-secondary"
      />
      {results.length > 0 && (
        <div className="absolute top-full z-50 mt-1 w-full rounded-md border border-border bg-card shadow-lg">
          {results.map((player) => (
            <button
              key={player.id}
              onClick={() => handleSelect(player.id)}
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
        </div>
      )}
      {loading && (
        <div className="absolute top-full z-50 mt-1 w-full rounded-md border border-border bg-card p-3 text-center text-sm text-muted-foreground shadow-lg">
          Searching...
        </div>
      )}
    </div>
  )
}
