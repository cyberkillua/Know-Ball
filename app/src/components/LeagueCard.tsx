import { Link } from '@tanstack/react-router'
import type { League } from '../lib/types'

const COUNTRY_FLAGS: Record<string, string> = {
  'England': '🏴󠁧󠁢󠁥󠁮󠁧󠁿',
  'Spain': '🇪🇸',
  'Italy': '🇮🇹',
  'Germany': '🇩🇪',
  'France': '🇫🇷',
}

const LEAGUE_COLORS: Record<string, string> = {
  'Premier League': 'bg-purple-500/15 border-purple-500/30',
  'La Liga': 'bg-orange-500/15 border-orange-500/30',
  'Serie A': 'bg-green-500/15 border-green-500/30',
  'Bundesliga': 'bg-red-500/15 border-red-500/30',
  'Ligue 1': 'bg-blue-500/15 border-blue-500/30',
  'Championship': 'bg-cyan-500/15 border-cyan-500/30',
}

const DEFAULT_COLOR = 'bg-primary/15 border-primary/30'

interface LeagueCardProps {
  league: League
  playerCount?: number
}

export default function LeagueCard({ league, playerCount }: LeagueCardProps) {
  const flag = COUNTRY_FLAGS[league.country] || '⚽'
  const colorClasses = LEAGUE_COLORS[league.name] || DEFAULT_COLOR

  return (
    <Link to="/league/$id" params={{ id: String(league.id) }} className={`block rounded-none border p-4 ${colorClasses}`}>
      <div className="flex items-center gap-3 mb-2">
        <span className="text-2xl">{flag}</span>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-foreground truncate">{league.name}</div>
          <div className="text-xs text-muted-foreground">{league.country}</div>
        </div>
      </div>
      {playerCount !== undefined && (
        <div className="text-sm text-muted-foreground">
          {playerCount.toLocaleString()} players
        </div>
      )}
    </Link>
  )
}