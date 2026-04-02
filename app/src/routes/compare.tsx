import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Input } from '../components/ui/input'
import RadarChart from '../components/charts/RadarChart'
import StatRow from '../components/StatRow'
import {
  searchPlayers,
  getPlayerRatings,
  getPlayerPeerRating,
  getPlayerStats,
} from '../lib/queries'
import type { Player, MatchRating, PeerRating, PlayerStats } from '../lib/types'

export const Route = createFileRoute('/compare')({ component: ComparePage })

const CURRENT_SEASON = '2025/2026'

const fmt = (v: any, decimals = 2) => {
  if (v == null) return '—'
  const num = Number(v)
  if (isNaN(num)) return '—'
  return num.toFixed(decimals)
}

const fmtPct = (v: any) =>
  v != null ? `${Math.round(Number(v) * 100)}%` : '—'

interface PlayerData {
  player: Player
  ratings: MatchRating[]
  peerRating: PeerRating | null
  stats: PlayerStats | null
}

function ComparePage() {
  const [playerA, setPlayerA] = useState<PlayerData | null>(null)
  const [playerB, setPlayerB] = useState<PlayerData | null>(null)
  const [searchA, setSearchA] = useState('')
  const [searchB, setSearchB] = useState('')
  const [resultsA, setResultsA] = useState<Player[]>([])
  const [resultsB, setResultsB] = useState<Player[]>([])
  const [statMode, setStatMode] = useState<'per90' | 'raw'>('per90')

  async function handleSearch(value: string, side: 'A' | 'B') {
    if (side === 'A') setSearchA(value)
    else setSearchB(value)

    if (value.length < 2) {
      if (side === 'A') setResultsA([])
      else setResultsB([])
      return
    }
    const results = await searchPlayers({ data: { query: value } })
    if (side === 'A') setResultsA(results)
    else setResultsB(results)
  }

  async function selectPlayer(player: Player, side: 'A' | 'B') {
    const [ratings, peerRating, stats] = await Promise.all([
      getPlayerRatings({ data: { playerId: player.id, season: CURRENT_SEASON } }),
      getPlayerPeerRating({ data: { playerId: player.id, season: CURRENT_SEASON } }),
      getPlayerStats({ data: { playerId: player.id, season: CURRENT_SEASON } }),
    ])
    const data: PlayerData = { player, ratings, peerRating, stats: stats as PlayerStats | null }
    if (side === 'A') {
      setPlayerA(data)
      setSearchA('')
      setResultsA([])
    } else {
      setPlayerB(data)
      setSearchB('')
      setResultsB([])
    }
  }

  function getAvgCategories(ratings: MatchRating[]) {
    if (ratings.length === 0) return null
    return {
      finishing: ratings.reduce((s, r) => s + Number(r.finishing_norm), 0) / ratings.length,
      involvement: ratings.reduce((s, r) => s + Number(r.involvement_norm), 0) / ratings.length,
      carrying: ratings.reduce((s, r) => s + Number(r.carrying_norm), 0) / ratings.length,
      physical: ratings.reduce((s, r) => s + Number(r.physical_norm), 0) / ratings.length,
      pressing: ratings.reduce((s, r) => s + Number(r.pressing_norm), 0) / ratings.length,
    }
}

const catsA = playerA ? getAvgCategories(playerA.ratings) : null
  const catsB = playerB ? getAvgCategories(playerB.ratings) : null

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Compare Players</h1>
        <p className="mt-1 text-sm text-muted-foreground">Head-to-head player comparison</p>
      </div>

      {/* Search selectors */}
      <div className="grid gap-4 md:grid-cols-2">
        <PlayerSelector
          label="Player 1"
          search={searchA}
          results={resultsA}
          selected={playerA}
          onSearch={(v) => handleSearch(v, 'A')}
          onSelect={(p) => selectPlayer(p, 'A')}
          color="var(--cat-finishing)"
        />
        <PlayerSelector
          label="Player 2"
          search={searchB}
          results={resultsB}
          selected={playerB}
          onSearch={(v) => handleSearch(v, 'B')}
          onSelect={(p) => selectPlayer(p, 'B')}
          color="var(--cat-involvement)"
        />
      </div>

      {playerA && playerB && (
        <div className="space-y-4">
          {/* Combined Radar Overlay */}
          {catsA && catsB && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>Skill Comparison</span>
                  <div className="flex items-center gap-4 text-xs">
                    <span className="flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: 'var(--cat-finishing)' }} />
                      {playerA.player.name}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: 'var(--cat-involvement)' }} />
                      {playerB.player.name}
                    </span>
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <RadarChart categories={catsA} categories2={catsB} />
              </CardContent>
            </Card>
          )}

          {/* Side-by-side Percentile Rankings */}
          <PercentileComparison playerA={playerA} playerB={playerB} statMode={statMode} setStatMode={setStatMode} />
        </div>
      )}
    </div>
  )
}

function PercentileComparison({ 
  playerA, 
  playerB, 
  statMode, 
  setStatMode 
}: { 
  playerA: PlayerData
  playerB: PlayerData
  statMode: 'per90' | 'raw'
  setStatMode: (m: 'per90' | 'raw') => void 
}) {
  const prA = playerA.peerRating
  const prB = playerB.peerRating
  const statsA = playerA.stats
  const statsB = playerB.stats
  const qualifiedA = (statsA?.minutes ?? 0) >= 300
  const qualifiedB = (statsB?.minutes ?? 0) >= 300

  const getPositionLabel = (position: string | null) => {
    const labels: Record<string, string> = {
      ST: 'Strikers', CF: 'Centre-Forwards', LW: 'Left Wingers', RW: 'Right Wingers',
      CAM: 'Attacking Midfielders', CM: 'Central Midfielders', CDM: 'Defensive Midfielders',
      LB: 'Left Backs', RB: 'Right Backs', CB: 'Centre-Backs', GK: 'Goalkeepers',
    }
    return labels[position ?? 'ST'] ?? position ?? 'Strikers'
  }

  type StatDef = {
    labelPer90: string
    labelRaw: string
    per90Key: keyof PlayerStats
    rawKey: keyof PlayerStats
    per90PctKey: keyof PeerRating
    rawPctKey: keyof PeerRating
    isPct?: boolean
  }

  const statSections: { title: string; stats: StatDef[] }[] = [
    {
      title: 'Goalscoring',
      stats: [
        { labelPer90: 'Goals/90', labelRaw: 'Goals', per90Key: 'goals_per90', rawKey: 'goals', per90PctKey: 'goals_per90_percentile', rawPctKey: 'goals_raw_percentile' },
        { labelPer90: 'Shots/90', labelRaw: 'Shots', per90Key: 'shots_per90', rawKey: 'shots', per90PctKey: 'shots_per90_percentile', rawPctKey: 'shots_raw_percentile' },
        { labelPer90: 'xG/90', labelRaw: 'xG', per90Key: 'xg_per90', rawKey: 'xg', per90PctKey: 'xg_per90_percentile', rawPctKey: 'xg_raw_percentile' },
        { labelPer90: 'SoT%', labelRaw: 'SoT%', per90Key: 'shot_on_target_rate', rawKey: 'shot_on_target_rate', per90PctKey: 'shot_on_target_percentile', rawPctKey: 'shot_on_target_percentile', isPct: true },
        { labelPer90: 'xG/shot', labelRaw: 'xG/shot', per90Key: 'xg_per_shot', rawKey: 'xg_per_shot', per90PctKey: 'xg_per_shot_percentile', rawPctKey: 'xg_per_shot_percentile' },
        { labelPer90: 'Conv%', labelRaw: 'Conv%', per90Key: 'shot_conversion_rate', rawKey: 'shot_conversion_rate', per90PctKey: 'shot_conversion_percentile', rawPctKey: 'shot_conversion_percentile', isPct: true },
        { labelPer90: 'xA/90', labelRaw: 'xA', per90Key: 'xa_per90', rawKey: 'xa', per90PctKey: 'xa_per90_percentile', rawPctKey: 'xa_raw_percentile' },
        { labelPer90: 'Assists/90', labelRaw: 'Assists', per90Key: 'assists_per90', rawKey: 'assists', per90PctKey: 'assists_per90_percentile', rawPctKey: 'assists_raw_percentile' },
      ],
    },
    {
      title: 'Ball carrying',
      stats: [
        { labelPer90: 'Drb%', labelRaw: 'Drb%', per90Key: 'dribble_success_rate', rawKey: 'dribble_success_rate', per90PctKey: 'dribble_success_percentile', rawPctKey: 'dribble_success_percentile', isPct: true },
        { labelPer90: 'Drb/90', labelRaw: 'Drb', per90Key: 'dribbles_per90', rawKey: 'dribbles', per90PctKey: 'dribbles_per90_percentile', rawPctKey: 'dribbles_raw_percentile' },
        { labelPer90: 'Fw/90', labelRaw: 'Fouls won', per90Key: 'fouls_won_per90', rawKey: 'fouls_won', per90PctKey: 'fouls_won_per90_percentile', rawPctKey: 'fouls_won_raw_percentile' },
        { labelPer90: 'Tch/90', labelRaw: 'Touches', per90Key: 'touches_per90', rawKey: 'touches', per90PctKey: 'touches_per90_percentile', rawPctKey: 'touches_raw_percentile' },
      ],
    },
    {
      title: 'Physical',
      stats: [
        { labelPer90: 'Air%', labelRaw: 'Air%', per90Key: 'aerial_win_rate', rawKey: 'aerial_win_rate', per90PctKey: 'physical_percentile', rawPctKey: 'physical_percentile', isPct: true },
        { labelPer90: 'Air/90', labelRaw: 'Aerials', per90Key: 'aerials_per90', rawKey: 'aerials_won', per90PctKey: 'aerials_per90_percentile', rawPctKey: 'aerials_won_raw_percentile' },
        { labelPer90: 'Grd%', labelRaw: 'Grd%', per90Key: 'ground_duel_win_rate', rawKey: 'ground_duel_win_rate', per90PctKey: 'physical_percentile', rawPctKey: 'physical_percentile', isPct: true },
        { labelPer90: 'Grd/90', labelRaw: 'Ground', per90Key: 'ground_duels_won_per90', rawKey: 'ground_duels_won', per90PctKey: 'ground_duels_won_per90_percentile', rawPctKey: 'ground_duels_won_raw_percentile' },
      ],
    },
    {
      title: 'Pressing',
      stats: [
        { labelPer90: 'Rec/90', labelRaw: 'Recov', per90Key: 'ball_recovery_per90', rawKey: 'ball_recoveries', per90PctKey: 'ball_recoveries_per90_percentile', rawPctKey: 'ball_recoveries_raw_percentile' },
        { labelPer90: 'Tkl/90', labelRaw: 'Tackles', per90Key: 'tackles_per90', rawKey: 'tackles', per90PctKey: 'tackles_per90_percentile', rawPctKey: 'tackles_raw_percentile' },
        { labelPer90: 'Int/90', labelRaw: 'Int', per90Key: 'interceptions_per90', rawKey: 'interceptions', per90PctKey: 'interceptions_per90_percentile', rawPctKey: 'interceptions_raw_percentile' },
      ],
    },
  ]

  const getLabel = (stat: StatDef) => statMode === 'per90' ? stat.labelPer90 : stat.labelRaw

  const getVal = (stat: StatDef, stats: PlayerStats | null) => {
    if (!stats) return '—'
    if (statMode === 'raw') {
      const v = stats[stat.rawKey]
      return v != null ? String(v) : '—'
    }
    const v = stats[stat.per90Key]
    return v != null ? (stat.isPct ? fmtPct(v) : fmt(v)) : '—'
  }

  const getPct = (stat: StatDef, pr: PeerRating | null, qualified: boolean) => {
    if (!qualified || !pr) return 0
    if (statMode === 'raw') return (pr[stat.rawPctKey] as number | null) ?? 0
    return (pr[stat.per90PctKey] as number | null) ?? 0
  }

  return (
    <Card>
      <CardContent className="p-6">
        <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
          <div>
            <h3 className="text-lg font-semibold">Percentile Rankings</h3>
            <p className="text-xs text-muted-foreground">
              Comparing vs {getPositionLabel(playerA.player.position)} in {(playerA.player.team as any)?.league?.name ?? 'league'}
            </p>
          </div>
          <div className="flex rounded-lg border border-border bg-card p-0.5 text-xs font-medium">
            <button
              onClick={() => setStatMode('per90')}
              className={`rounded-md px-3 py-1 transition-colors ${statMode === 'per90' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              Per 90
            </button>
            <button
              onClick={() => setStatMode('raw')}
              className={`rounded-md px-3 py-1 transition-colors ${statMode === 'raw' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              Raw
            </button>
          </div>
        </div>

        <div className="mb-4 grid grid-cols-3 gap-4">
          <div className="text-center">
            <div className="font-semibold">{playerA.player.name}</div>
            <div className="text-xs text-muted-foreground">{statsA?.matches ?? 0} apps · {statsA?.minutes?.toLocaleString() ?? 0} mins</div>
          </div>
          <div></div>
          <div className="text-center">
            <div className="font-semibold">{playerB.player.name}</div>
            <div className="text-xs text-muted-foreground">{statsB?.matches ?? 0} apps · {statsB?.minutes?.toLocaleString() ?? 0} mins</div>
          </div>
        </div>

        {!qualifiedA || !qualifiedB ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            Percentile data requires 300+ minutes played
            {!qualifiedA && <div className="mt-1">{playerA.player.name}: {statsA?.minutes ?? 0} mins</div>}
            {!qualifiedB && <div className="mt-1">{playerB.player.name}: {statsB?.minutes ?? 0} mins</div>}
          </div>
        ) : (
          statSections.map((section) => (
            <div key={section.title} className="mb-6">
              <h4 className="mb-3 text-sm font-medium text-foreground">{section.title}</h4>
              {section.stats.map((stat) => {
                const valA = getVal(stat, statsA)
                const valB = getVal(stat, statsB)
                const pctA = getPct(stat, prA, qualifiedA)
                const pctB = getPct(stat, prB, qualifiedB)
                const label = getLabel(stat)
                return (
                  <div key={label} className="grid grid-cols-3 gap-4 mb-2">
                    <StatRow label="" value={valA} percentile={pctA} />
                    <div className="text-center text-xs text-muted-foreground self-center">{label}</div>
                    <StatRow label="" value={valB} percentile={pctB} />
                  </div>
                )
              })}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}

function PlayerSelector({ label, search, results, selected, onSearch, onSelect, color }: {
  label: string; search: string; results: Player[]; selected: PlayerData | null
  onSearch: (v: string) => void; onSelect: (p: Player) => void; color: string
}) {
  return (
    <div className="relative">
      <label className="mb-2 block text-sm font-semibold" style={{ color }}>{label}</label>
      <Input placeholder="Search player name..." value={search} onChange={(e) => onSearch(e.target.value)} className="bg-secondary" />
      {results.length > 0 && (
        <div className="absolute top-full z-50 mt-1 w-full rounded-md border border-border bg-card shadow-lg">
          {results.map((p) => (
            <button key={p.id} onClick={() => onSelect(p)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent">
              <span className="font-medium">{p.name}</span>
              <span className="text-xs text-muted-foreground">{p.position} · {(p.team as any)?.name}</span>
            </button>
          ))}
        </div>
      )}
      {selected && (
        <div className="mt-2 rounded-lg border border-border bg-card/50 p-3">
          <div className="font-semibold">{selected.player.name}</div>
          <div className="text-xs text-muted-foreground">
            {(selected.player.team as any)?.name}
          </div>
        </div>
      )}
    </div>
  )
}
