import { Tabs, TabsList, TabsTrigger } from './ui/tabs'
import type { League } from '../lib/types'

const LEAGUE_SHORT_NAMES: Record<string, string> = {
  'Premier League': 'PL',
  Championship: 'EFL',
  'La Liga': 'La Liga',
  'Ligue 1': 'Ligue 1',
  'Serie A': 'Serie A',
  Bundesliga: 'BL',
}

export default function LeagueTabs({
  leagues,
  activeId,
  onChange,
}: {
  leagues: League[]
  activeId: number
  onChange: (leagueId: number) => void
}) {
  return (
    <Tabs value={String(activeId)} onValueChange={(v) => onChange(Number(v))}>
      <TabsList className="w-full justify-start overflow-x-auto">
        {leagues.map((league) => (
          <TabsTrigger key={league.id} value={String(league.id)} className="text-xs sm:text-sm">
            {LEAGUE_SHORT_NAMES[league.name] ?? league.name}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}
