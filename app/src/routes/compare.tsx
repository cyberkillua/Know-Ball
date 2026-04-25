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
  getPlayerSeasons,
} from '../lib/queries'
import type { Player, MatchRating, PeerRating, PlayerPeerRatingResponse, PlayerStats } from '../lib/types'

export const Route = createFileRoute('/compare')({ component: ComparePage })

const CURRENT_SEASON = '2025/2026' // fallback only

const fmt = (v: any, decimals = 2) => {
  if (v == null) return '—'
  const num = Number(v)
  if (isNaN(num)) return '—'
  return num.toFixed(decimals)
}

const fmtPct = (v: any) =>
  v != null ? `${Math.round(Number(v) * 100)}%` : '—'

type SeasonOption = { season: string; league_id: number; league_name: string; matches: number }

interface PlayerData {
  player: Player
  seasons: SeasonOption[]
  season: string // 'leagueId|season' key
  ratings: MatchRating[]
  peerRating: PeerRating | null
  stats: PlayerStats | null
}

async function loadSeasonData(player: Player, seasonKey: string): Promise<Omit<PlayerData, 'player' | 'seasons'>> {
  const [leagueIdStr, seasonStr] = seasonKey.split('|')
  const leagueId = Number(leagueIdStr)
  const [ratings, peerResp, stats] = await Promise.all([
    getPlayerRatings({ data: { playerId: player.id, season: seasonStr, leagueId } }),
    getPlayerPeerRating({ data: { playerId: player.id, season: seasonStr, leagueId, scope: 'league' } }),
    getPlayerStats({ data: { playerId: player.id, season: seasonStr, leagueId } }),
  ])
  const { peerRating } = peerResp as PlayerPeerRatingResponse
  return { season: seasonKey, ratings, peerRating, stats: stats as PlayerStats | null }
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
    const seasons = await getPlayerSeasons({ data: { playerId: player.id } })
    const first = seasons[0]
    const seasonKey = first ? `${first.league_id}|${first.season}` : `0|${CURRENT_SEASON}`
    const seasonData = await loadSeasonData(player, seasonKey)
    const data: PlayerData = { player, seasons, ...seasonData }
    if (side === 'A') { setPlayerA(data); setSearchA(''); setResultsA([]) }
    else { setPlayerB(data); setSearchB(''); setResultsB([]) }
  }

  async function changeSeason(seasonKey: string, side: 'A' | 'B') {
    const current = side === 'A' ? playerA : playerB
    if (!current) return
    const seasonData = await loadSeasonData(current.player, seasonKey)
    const updated = { ...current, ...seasonData }
    if (side === 'A') setPlayerA(updated)
    else setPlayerB(updated)
  }

  function getAvgCategories(ratings: MatchRating[]) {
    if (ratings.length === 0) return null
    const n = ratings.length
    return {
      finishing: ratings.reduce((s, r) => s + Number(r.finishing_norm), 0) / n,
      shot_generation: ratings.reduce((s, r) => s + Number(r.shot_generation_norm), 0) / n,
      chance_creation: ratings.reduce((s, r) => s + Number(r.chance_creation_norm), 0) / n,
      team_function: ratings.reduce((s, r) => s + Number(r.team_function_norm), 0) / n,
      carrying: ratings.reduce((s, r) => s + Number(r.carrying_norm), 0) / n,
      duels: ratings.reduce((s, r) => s + Number(r.duels_norm), 0) / n,
      defensive: ratings.reduce((s, r) => s + Number(r.defensive_norm), 0) / n,
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
      <div className="grid gap-4 sm:grid-cols-2">
        <PlayerSelector
          label="Player 1"
          search={searchA}
          results={resultsA}
          selected={playerA}
          onSearch={(v) => handleSearch(v, 'A')}
          onSelect={(p) => selectPlayer(p, 'A')}
          onSeasonChange={(s) => changeSeason(s, 'A')}
          color="var(--cat-finishing)"
        />
        <PlayerSelector
          label="Player 2"
          search={searchB}
          results={resultsB}
          selected={playerB}
          onSearch={(v) => handleSearch(v, 'B')}
          onSelect={(p) => selectPlayer(p, 'B')}
          onSeasonChange={(s) => changeSeason(s, 'B')}
          color="var(--cat-involvement)"
        />
      </div>

      {playerA && playerB && (
        <div className="space-y-4">
          {/* Combined Radar Overlay */}
          {catsA && catsB && (
            <Card>
              <CardHeader>
                <CardTitle className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <span>Skill Comparison</span>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
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

          {/* Peer Comparison (same position only) */}
          {(playerA.peerRating?.position ?? playerA.player.position) === (playerB.peerRating?.position ?? playerB.player.position) && (
            <PeerComparisonSideBySide playerA={playerA} playerB={playerB} />
          )}
        </div>
      )}
    </div>
  )
}

type StatDef = {
  labelPer90: string
  labelRaw: string
  per90Key?: keyof PlayerStats
  rawKey?: keyof PlayerStats
  per90PctKey?: keyof PeerRating
  rawPctKey?: keyof PeerRating
  isPct?: boolean
  valFn?: (stats: PlayerStats, mode: 'per90' | 'raw') => string
  pctFn?: (pr: PeerRating, mode: 'per90' | 'raw') => number
}

type Section = { title: string; stats: StatDef[] }

const S = {
  goalscoring: {
    title: 'Goal Threat',
    stats: [
      { labelPer90: 'Goals per 90', labelRaw: 'Goals', per90Key: 'goals_per90', rawKey: 'goals', per90PctKey: 'goals_per90_percentile', rawPctKey: 'goals_raw_percentile' },
      { labelPer90: 'Shots per 90', labelRaw: 'Shots', per90Key: 'shots_per90', rawKey: 'shots', per90PctKey: 'shots_per90_percentile', rawPctKey: 'shots_raw_percentile' },
      { labelPer90: 'xG per 90', labelRaw: 'xG', per90Key: 'xg_per90', rawKey: 'xg', per90PctKey: 'xg_per90_percentile', rawPctKey: 'xg_raw_percentile' },
      { labelPer90: 'Shot on target %', labelRaw: 'Shot on target %', per90Key: 'shot_on_target_rate', rawKey: 'shot_on_target_rate', per90PctKey: 'shot_on_target_percentile', rawPctKey: 'shot_on_target_percentile', isPct: true },
      { labelPer90: 'xG per shot', labelRaw: 'xG per shot', per90Key: 'xg_per_shot', rawKey: 'xg_per_shot', per90PctKey: 'xg_per_shot_percentile', rawPctKey: 'xg_per_shot_percentile' },
      { labelPer90: 'Shot conversion %', labelRaw: 'Shot conversion %', per90Key: 'shot_conversion_rate', rawKey: 'shot_conversion_rate', per90PctKey: 'shot_conversion_percentile', rawPctKey: 'shot_conversion_percentile', isPct: true },
      { labelPer90: 'xGOT per 90', labelRaw: 'xGOT', per90Key: 'xgot_per90', rawKey: 'xgot', per90PctKey: 'xgot_per90_percentile', rawPctKey: 'xgot_raw_percentile' },
      { labelPer90: 'Big chances missed / 90', labelRaw: 'Big chances missed', per90Key: 'big_chances_missed_per90', rawKey: 'big_chances_missed', per90PctKey: 'big_chances_missed_percentile', rawPctKey: 'big_chances_missed_raw_percentile' },
      { labelPer90: 'np Goals per 90', labelRaw: 'np Goals', per90Key: 'np_goals_per90', rawKey: 'np_goals', per90PctKey: 'np_goals_per90_percentile', rawPctKey: 'np_goals_raw_percentile' },
      { labelPer90: 'np xG per 90', labelRaw: 'np xG', per90Key: 'np_xg_per90', rawKey: 'np_xg_total', per90PctKey: 'np_xg_per90_percentile', rawPctKey: 'np_xg_raw_percentile' },
      { labelPer90: 'np xG per shot', labelRaw: 'np xG per shot', per90Key: 'np_xg_per_shot', rawKey: 'np_xg_per_shot', per90PctKey: 'np_xg_per_shot_percentile', rawPctKey: 'np_xg_per_shot_percentile' },
    ],
  } as Section,
  chanceCreationFull: {
    title: 'Chance Creation',
    stats: [
      { labelPer90: 'xA per 90', labelRaw: 'xA', per90Key: 'xa_per90', rawKey: 'xa', per90PctKey: 'xa_per90_percentile', rawPctKey: 'xa_raw_percentile' },
      { labelPer90: 'Assists per 90', labelRaw: 'Assists', per90Key: 'assists_per90', rawKey: 'assists', per90PctKey: 'assists_per90_percentile', rawPctKey: 'assists_raw_percentile' },
      { labelPer90: 'xG + xA per 90', labelRaw: 'xG + xA', per90Key: 'xg_plus_xa_per90', rawKey: 'xg_plus_xa', per90PctKey: 'xg_plus_xa_percentile', rawPctKey: 'xg_plus_xa_raw_percentile' },
      { labelPer90: 'Key passes per 90', labelRaw: 'Key passes', per90Key: 'key_passes_per90', rawKey: 'key_passes', per90PctKey: 'key_passes_per90_percentile', rawPctKey: 'key_passes_raw_percentile' },
      { labelPer90: 'Big chances created / 90', labelRaw: 'Big chances created', per90Key: 'big_chances_created_per90', rawKey: 'big_chances_created', per90PctKey: 'big_chances_created_percentile', rawPctKey: 'big_chances_created_raw_percentile' },
      { labelPer90: 'Accurate crosses / 90', labelRaw: 'Accurate crosses', per90Key: 'accurate_cross_per90', rawKey: 'accurate_cross', per90PctKey: 'accurate_cross_per90_percentile', rawPctKey: 'accurate_cross_raw_percentile' },
    ],
  } as Section,
  chanceCreationNoXgXa: {
    title: 'Chance Creation',
    stats: [
      { labelPer90: 'xA per 90', labelRaw: 'xA', per90Key: 'xa_per90', rawKey: 'xa', per90PctKey: 'xa_per90_percentile', rawPctKey: 'xa_raw_percentile' },
      { labelPer90: 'Assists per 90', labelRaw: 'Assists', per90Key: 'assists_per90', rawKey: 'assists', per90PctKey: 'assists_per90_percentile', rawPctKey: 'assists_raw_percentile' },
      { labelPer90: 'Key passes per 90', labelRaw: 'Key passes', per90Key: 'key_passes_per90', rawKey: 'key_passes', per90PctKey: 'key_passes_per90_percentile', rawPctKey: 'key_passes_raw_percentile' },
      { labelPer90: 'Big chances created / 90', labelRaw: 'Big chances created', per90Key: 'big_chances_created_per90', rawKey: 'big_chances_created', per90PctKey: 'big_chances_created_percentile', rawPctKey: 'big_chances_created_raw_percentile' },
    ],
  } as Section,
  chanceCreationDefWinger: {
    title: 'Chance Creation',
    stats: [
      { labelPer90: 'xA per 90', labelRaw: 'xA', per90Key: 'xa_per90', rawKey: 'xa', per90PctKey: 'xa_per90_percentile', rawPctKey: 'xa_raw_percentile' },
      { labelPer90: 'Assists per 90', labelRaw: 'Assists', per90Key: 'assists_per90', rawKey: 'assists', per90PctKey: 'assists_per90_percentile', rawPctKey: 'assists_raw_percentile' },
      { labelPer90: 'xG + xA per 90', labelRaw: 'xG + xA', per90Key: 'xg_plus_xa_per90', rawKey: 'xg_plus_xa', per90PctKey: 'xg_plus_xa_percentile', rawPctKey: 'xg_plus_xa_raw_percentile' },
      { labelPer90: 'Key passes per 90', labelRaw: 'Key passes', per90Key: 'key_passes_per90', rawKey: 'key_passes', per90PctKey: 'key_passes_per90_percentile', rawPctKey: 'key_passes_raw_percentile' },
      { labelPer90: 'Accurate crosses / 90', labelRaw: 'Accurate crosses', per90Key: 'accurate_cross_per90', rawKey: 'accurate_cross', per90PctKey: 'accurate_cross_per90_percentile', rawPctKey: 'accurate_cross_raw_percentile' },
    ],
  } as Section,
  chanceCreationDefender: {
    title: 'Chance Creation',
    stats: [
      { labelPer90: 'xA per 90', labelRaw: 'xA', per90Key: 'xa_per90', rawKey: 'xa', per90PctKey: 'xa_per90_percentile', rawPctKey: 'xa_raw_percentile' },
      { labelPer90: 'Assists per 90', labelRaw: 'Assists', per90Key: 'assists_per90', rawKey: 'assists', per90PctKey: 'assists_per90_percentile', rawPctKey: 'assists_raw_percentile' },
      { labelPer90: 'Accurate crosses / 90', labelRaw: 'Accurate crosses', per90Key: 'accurate_cross_per90', rawKey: 'accurate_cross', per90PctKey: 'accurate_cross_per90_percentile', rawPctKey: 'accurate_cross_raw_percentile' },
      { labelPer90: 'Key passes per 90', labelRaw: 'Key passes', per90Key: 'key_passes_per90', rawKey: 'key_passes', per90PctKey: 'key_passes_per90_percentile', rawPctKey: 'key_passes_raw_percentile' },
    ],
  } as Section,
  passing: {
    title: 'Passing',
    stats: [
      { labelPer90: 'Passes per 90', labelRaw: 'Passes', valFn: (s: PlayerStats, mode: 'per90' | 'raw') => mode === 'per90' ? fmt(s.minutes > 0 ? (s.passes_completed / s.minutes) * 90 : null) : String(s.passes_completed ?? 0), per90PctKey: 'passes_completed_per90_percentile', rawPctKey: 'passes_completed_raw_percentile' },
      { labelPer90: 'Passing accuracy', labelRaw: 'Passing accuracy', valFn: (s: PlayerStats) => fmtPct(s.passes_total > 0 ? s.passes_completed / s.passes_total : null), per90PctKey: 'passing_accuracy_percentile', rawPctKey: 'passing_accuracy_percentile', isPct: true },
      { labelPer90: 'Accurate long balls / 90', labelRaw: 'Accurate long balls', valFn: (s: PlayerStats, mode: 'per90' | 'raw') => mode === 'per90' ? fmt(s.minutes > 0 ? (s.accurate_long_balls / s.minutes) * 90 : null) : String(s.accurate_long_balls ?? 0), per90PctKey: 'accurate_long_balls_per90_percentile', rawPctKey: 'accurate_long_balls_raw_percentile' },
      { labelPer90: 'Long ball accuracy', labelRaw: 'Long ball accuracy', valFn: (s: PlayerStats) => fmtPct(s.total_long_balls > 0 ? s.accurate_long_balls / s.total_long_balls : null), per90PctKey: 'long_ball_accuracy_percentile', rawPctKey: 'long_ball_accuracy_percentile', isPct: true },
    ],
  } as Section,
  carryingFull: {
    title: 'Ball Carrying',
    stats: [
      { labelPer90: 'Dribble success %', labelRaw: 'Dribble success %', per90Key: 'dribble_success_rate', rawKey: 'dribble_success_rate', per90PctKey: 'dribble_success_percentile', rawPctKey: 'dribble_success_percentile', isPct: true },
      { labelPer90: 'Successful dribbles / 90', labelRaw: 'Successful dribbles', per90Key: 'dribbles_per90', rawKey: 'dribbles', per90PctKey: 'dribbles_per90_percentile', rawPctKey: 'dribbles_raw_percentile' },
      { labelPer90: 'Fouls won / 90', labelRaw: 'Fouls won', per90Key: 'fouls_won_per90', rawKey: 'fouls_won', per90PctKey: 'fouls_won_per90_percentile', rawPctKey: 'fouls_won_raw_percentile' },
      { labelPer90: 'Touches per 90', labelRaw: 'Touches', per90Key: 'touches_per90', rawKey: 'touches', per90PctKey: 'touches_per90_percentile', rawPctKey: 'touches_raw_percentile' },
      { labelPer90: 'Possession loss rate', labelRaw: 'Possession loss rate', valFn: (s: PlayerStats) => fmtPct(s.possession_loss_rate), per90PctKey: 'possession_loss_rate_percentile', rawPctKey: 'possession_loss_rate_percentile', isPct: true },
    ],
  } as Section,
  carryingNoFouls: {
    title: 'Ball Carrying',
    stats: [
      { labelPer90: 'Dribble success %', labelRaw: 'Dribble success %', per90Key: 'dribble_success_rate', rawKey: 'dribble_success_rate', per90PctKey: 'dribble_success_percentile', rawPctKey: 'dribble_success_percentile', isPct: true },
      { labelPer90: 'Successful dribbles / 90', labelRaw: 'Successful dribbles', per90Key: 'dribbles_per90', rawKey: 'dribbles', per90PctKey: 'dribbles_per90_percentile', rawPctKey: 'dribbles_raw_percentile' },
      { labelPer90: 'Touches per 90', labelRaw: 'Touches', per90Key: 'touches_per90', rawKey: 'touches', per90PctKey: 'touches_per90_percentile', rawPctKey: 'touches_raw_percentile' },
      { labelPer90: 'Possession loss rate', labelRaw: 'Possession loss rate', valFn: (s: PlayerStats) => fmtPct(s.possession_loss_rate), per90PctKey: 'possession_loss_rate_percentile', rawPctKey: 'possession_loss_rate_percentile', isPct: true },
    ],
  } as Section,
  carryingDefender: {
    title: 'Ball Carrying',
    stats: [
      { labelPer90: 'Dribble success %', labelRaw: 'Dribble success %', per90Key: 'dribble_success_rate', rawKey: 'dribble_success_rate', per90PctKey: 'dribble_success_percentile', rawPctKey: 'dribble_success_percentile', isPct: true },
      { labelPer90: 'Touches per 90', labelRaw: 'Touches', per90Key: 'touches_per90', rawKey: 'touches', per90PctKey: 'touches_per90_percentile', rawPctKey: 'touches_raw_percentile' },
      { labelPer90: 'Possession loss rate', labelRaw: 'Possession loss rate', valFn: (s: PlayerStats) => fmtPct(s.possession_loss_rate), per90PctKey: 'possession_loss_rate_percentile', rawPctKey: 'possession_loss_rate_percentile', isPct: true },
    ],
  } as Section,
  physicalFull: {
    title: 'Physical Duels',
    stats: [
      { labelPer90: 'Aerial win %', labelRaw: 'Aerial win %', per90Key: 'aerial_win_rate', rawKey: 'aerial_win_rate', per90PctKey: 'aerial_win_rate_percentile', rawPctKey: 'aerial_win_rate_percentile', isPct: true },
      { labelPer90: 'Aerial wins / 90', labelRaw: 'Aerial wins', per90Key: 'aerials_per90', rawKey: 'aerials_won', per90PctKey: 'aerials_per90_percentile', rawPctKey: 'aerials_won_raw_percentile' },
      { labelPer90: 'Ground duel win %', labelRaw: 'Ground duel win %', per90Key: 'ground_duel_win_rate', rawKey: 'ground_duel_win_rate', per90PctKey: 'ground_duel_win_rate_percentile', rawPctKey: 'ground_duel_win_rate_percentile', isPct: true },
      { labelPer90: 'Ground duel wins / 90', labelRaw: 'Ground duel wins', per90Key: 'ground_duels_won_per90', rawKey: 'ground_duels_won', per90PctKey: 'ground_duels_won_per90_percentile', rawPctKey: 'ground_duels_won_raw_percentile' },
      { labelPer90: 'Total contests / 90', labelRaw: 'Total contests', per90Key: 'total_contest_per90', rawKey: 'total_contests', per90PctKey: 'total_contest_per90_percentile', rawPctKey: 'total_contests_raw_percentile' },
    ],
  } as Section,
  physicalNoAerialWins: {
    title: 'Physical Duels',
    stats: [
      { labelPer90: 'Aerial win %', labelRaw: 'Aerial win %', per90Key: 'aerial_win_rate', rawKey: 'aerial_win_rate', per90PctKey: 'aerial_win_rate_percentile', rawPctKey: 'aerial_win_rate_percentile', isPct: true },
      { labelPer90: 'Ground duel win %', labelRaw: 'Ground duel win %', per90Key: 'ground_duel_win_rate', rawKey: 'ground_duel_win_rate', per90PctKey: 'ground_duel_win_rate_percentile', rawPctKey: 'ground_duel_win_rate_percentile', isPct: true },
      { labelPer90: 'Ground duel wins / 90', labelRaw: 'Ground duel wins', per90Key: 'ground_duels_won_per90', rawKey: 'ground_duels_won', per90PctKey: 'ground_duels_won_per90_percentile', rawPctKey: 'ground_duels_won_raw_percentile' },
      { labelPer90: 'Total contests / 90', labelRaw: 'Total contests', per90Key: 'total_contest_per90', rawKey: 'total_contests', per90PctKey: 'total_contest_per90_percentile', rawPctKey: 'total_contests_raw_percentile' },
    ],
  } as Section,
  defending: {
    title: 'Defending',
    stats: [
      { labelPer90: 'Ball recoveries / 90', labelRaw: 'Ball recoveries', per90Key: 'ball_recovery_per90', rawKey: 'ball_recoveries', per90PctKey: 'ball_recoveries_per90_percentile', rawPctKey: 'ball_recoveries_raw_percentile' },
      { labelPer90: 'Tackles won / 90', labelRaw: 'Tackles won', per90Key: 'tackles_per90', rawKey: 'tackles', per90PctKey: 'tackles_per90_percentile', rawPctKey: 'tackles_raw_percentile' },
      { labelPer90: 'Interceptions / 90', labelRaw: 'Interceptions', per90Key: 'interceptions_per90', rawKey: 'interceptions', per90PctKey: 'interceptions_per90_percentile', rawPctKey: 'interceptions_raw_percentile' },
      { labelPer90: 'Fouls committed / 90', labelRaw: 'Fouls committed', per90Key: 'fouls_committed_per90', rawKey: 'fouls_committed', per90PctKey: 'fouls_committed_per90_percentile', rawPctKey: 'fouls_committed_raw_percentile' },
    ],
  } as Section,
}

function getStatSectionsForPosition(position: string | null): Section[] {
  const pos = (position ?? 'ST').toUpperCase()
  const isST = pos === 'ST' || pos === 'CF'
  const isCAM = pos === 'CAM'
  const isWinger = pos === 'LW' || pos === 'RW'
  const isDefWinger = pos === 'LM' || pos === 'RM'
  const isCM = ['CM', 'CDM', 'DM', 'MID', 'MIDFIELDER'].includes(pos)
  const isDefender = pos === 'CB' || pos === 'LB' || pos === 'RB' || pos === 'LWB' || pos === 'RWB'

  if (isST) {
    return [S.goalscoring, S.chanceCreationFull, S.passing, S.carryingFull, S.physicalFull, S.defending]
  }
  if (isCAM || isWinger) {
    return [S.chanceCreationFull, S.passing, S.goalscoring, S.carryingFull, S.physicalFull, S.defending]
  }
  if (isDefWinger) {
    return [S.chanceCreationDefWinger, S.passing, S.defending, S.carryingNoFouls, S.physicalNoAerialWins, S.goalscoring]
  }
  if (isCM) {
    return [S.chanceCreationFull, S.passing, S.goalscoring, S.carryingFull, S.physicalNoAerialWins, S.defending]
  }
  if (isDefender) {
    return [S.physicalFull, S.defending, S.carryingDefender, S.passing, S.chanceCreationDefender, S.goalscoring]
  }
  // fallback
  return [S.chanceCreationFull, S.passing, S.carryingFull, S.physicalFull, S.defending, S.goalscoring]
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
  const qualifiedA = (prA?.minutes_played ?? 0) >= 300
  const qualifiedB = (prB?.minutes_played ?? 0) >= 300

  const statSections = getStatSectionsForPosition(prA?.position ?? playerA.player.position)

  const getLabel = (stat: StatDef) => statMode === 'per90' ? stat.labelPer90 : stat.labelRaw

  const getVal = (stat: StatDef, stats: PlayerStats | null) => {
    if (!stats) return '—'
    if (stat.valFn) return stat.valFn(stats, statMode)
    if (statMode === 'raw') {
      const v = stat.rawKey ? stats[stat.rawKey] : null
      return v != null ? (stat.isPct ? fmtPct(v) : String(v)) : '—'
    }
    const v = stat.per90Key ? stats[stat.per90Key] : null
    return v != null ? (stat.isPct ? fmtPct(v) : fmt(v)) : '—'
  }

  const getPct = (stat: StatDef, pr: PeerRating | null, qualified: boolean) => {
    if (!qualified || !pr) return 0
    if (stat.pctFn) return stat.pctFn(pr, statMode)
    if (statMode === 'raw') return (stat.rawPctKey ? (pr[stat.rawPctKey] as number | null) : null) ?? 0
    return (stat.per90PctKey ? (pr[stat.per90PctKey] as number | null) : null) ?? 0
  }

  return (
    <Card>
      <CardContent className="p-4 sm:p-6">
        <div className="mb-4 sm:mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-base sm:text-lg font-semibold">Percentile Rankings</h3>
            <p className="text-xs text-muted-foreground">
              {playerA.seasons.find(s => `${s.league_id}|${s.season}` === playerA.season)?.league_name ?? ''} {playerA.season.split('|')[1]} vs {playerB.seasons.find(s => `${s.league_id}|${s.season}` === playerB.season)?.league_name ?? ''} {playerB.season.split('|')[1]}
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

        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-4">
          <div className="text-center">
            <div className="font-semibold text-sm sm:text-base">{playerA.player.name}</div>
            <div className="text-xs text-muted-foreground">{statsA?.matches ?? 0} apps · {statsA?.minutes?.toLocaleString() ?? 0} mins</div>
          </div>
          <div className="hidden sm:block"></div>
          <div className="text-center">
            <div className="font-semibold text-sm sm:text-base">{playerB.player.name}</div>
            <div className="text-xs text-muted-foreground">{statsB?.matches ?? 0} apps · {statsB?.minutes?.toLocaleString() ?? 0} mins</div>
          </div>
        </div>

        {(!qualifiedA || !qualifiedB) && (
          <div className="mb-4 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            Percentile bars require 300+ peer-group minutes.
            {!qualifiedA && ` ${playerA.player.name}: ${prA?.minutes_played ?? 0} mins.`}
            {!qualifiedB && ` ${playerB.player.name}: ${prB?.minutes_played ?? 0} mins.`}
          </div>
        )}
        {statSections.map((section) => (
          <div key={section.title} className="mb-6">
            <h4 className="mb-3 text-sm font-medium text-foreground">{section.title}</h4>
            {section.stats.map((stat) => {
              const valA = getVal(stat, statsA)
              const valB = getVal(stat, statsB)
              const pctA = getPct(stat, prA, qualifiedA)
              const pctB = getPct(stat, prB, qualifiedB)
              const label = getLabel(stat)
              return (
                <div key={label} className="mb-3 sm:mb-2">
                  <div className="text-center text-xs text-muted-foreground mb-1 sm:hidden">{label}</div>
                  <div className="hidden sm:grid sm:grid-cols-3 sm:gap-4">
                    <StatRow label="" value={valA} percentile={pctA} />
                    <div className="text-center text-xs text-muted-foreground self-center">{label}</div>
                    <StatRow label="" value={valB} percentile={pctB} />
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:hidden">
                    <div className="flex flex-col items-center">
                      <div className="text-xs text-muted-foreground mb-1" style={{ color: 'var(--cat-finishing)' }}>P1</div>
                      <div className="relative w-full h-4 rounded overflow-hidden" style={{ background: 'var(--muted)' }}>
                        <div className="h-full flex items-center" style={{ width: `${Math.max(pctA, 8)}%`, background: pctA >= 70 ? '#1d9e75' : pctA >= 40 ? '#ef9f27' : '#e24b4a' }}>
                          <span className="pl-2 text-xs font-semibold text-white">{valA}</span>
                        </div>
                      </div>
                      <div className="text-xs font-medium mt-0.5" style={{ color: pctA >= 70 ? '#1d9e75' : pctA >= 40 ? '#ef9f27' : '#e24b4a' }}>{Math.round(pctA)}</div>
                    </div>
                    <div className="flex flex-col items-center">
                      <div className="text-xs text-muted-foreground mb-1" style={{ color: 'var(--cat-involvement)' }}>P2</div>
                      <div className="relative w-full h-4 rounded overflow-hidden" style={{ background: 'var(--muted)' }}>
                        <div className="h-full flex items-center" style={{ width: `${Math.max(pctB, 8)}%`, background: pctB >= 70 ? '#1d9e75' : pctB >= 40 ? '#ef9f27' : '#e24b4a' }}>
                          <span className="pl-2 text-xs font-semibold text-white">{valB}</span>
                        </div>
                      </div>
                      <div className="text-xs font-medium mt-0.5" style={{ color: pctB >= 70 ? '#1d9e75' : pctB >= 40 ? '#ef9f27' : '#e24b4a' }}>{Math.round(pctB)}</div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

const POSITION_LABELS: Record<string, string> = {
  ST: 'Strikers', CF: 'Centre-Forwards', LW: 'Wingers', RW: 'Wingers',
  WINGER: 'Wingers', LM: 'Left Midfielders', RM: 'Right Midfielders',
  CAM: 'Attacking Midfielders', CM: 'Central Midfielders', CDM: 'Central Midfielders',
  DM: 'Central Midfielders', MID: 'Central Midfielders', MIDFIELDER: 'Central Midfielders',
  LB: 'Left Backs', RB: 'Right Backs', LWB: 'Left Wing-Backs', RWB: 'Right Wing-Backs',
  CB: 'Centre-Backs', DEF: 'Defenders', GK: 'Goalkeepers',
}

function rateColor(val: number, low: number, high: number) {
  if (val >= high) return '#1d9e75'
  if (val >= low) return '#ef9f27'
  return '#e24b4a'
}

function PeerCard({ data }: { data: PlayerData }) {
  const pr = data.peerRating
  const qualified = (pr?.rated_minutes ?? 0) >= 300

  if (!qualified) {
    return (
      <div className="text-xs text-muted-foreground py-4">
        Requires 300+ rated minutes as {pr?.position ?? data.player.position ?? '—'}. Currently {pr?.rated_minutes ?? 0} mins.
      </div>
    )
  }
  if (!pr) {
    return <div className="text-xs text-muted-foreground py-4">No peer comparison data available.</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {pr.model_score != null && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: 'var(--muted)', borderRadius: 8 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Know Ball Score</span>
            <span style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>Overall season score for this role</span>
          </div>
          <span style={{ fontSize: 28, fontWeight: 700, color: Number(pr.model_score) >= 60 ? '#1d9e75' : Number(pr.model_score) >= 45 ? '#ef9f27' : '#e24b4a', flexShrink: 0, marginLeft: 16 }}>
            {Number(pr.model_score).toFixed(2)}
          </span>
        </div>
      )}
      {(pr.consistency_score != null || pr.impact_rate != null) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '14px 16px', background: 'var(--muted)', borderRadius: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Match Profile</div>
          {pr.consistency_score != null && (() => {
            const val = Number(pr.consistency_score)
            const filled = val / 10
            return (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                  <span style={{ fontSize: 12, color: 'var(--foreground)', fontWeight: 500 }}>Good Performance Rate</span>
                  <span style={{ fontSize: 16, fontWeight: 700, color: rateColor(val, 20, 70) }}>{val.toFixed(0)}%</span>
                </div>
                <div style={{ display: 'flex', gap: 2 }}>
                  {Array.from({ length: 10 }, (_, i) => {
                    const opacity = filled >= i + 1 ? 1 : filled > i ? filled - i : 0
                    return <div key={i} style={{ flex: 1, height: 6, borderRadius: 2, background: opacity > 0 ? rateColor((i + 0.5) * 10, 20, 70) : 'var(--border)', opacity: opacity > 0 && opacity < 1 ? 0.5 + opacity * 0.5 : 1 }} />
                  })}
                </div>
              </div>
            )
          })()}
          {pr.impact_rate != null && (() => {
            const val = Number(pr.impact_rate)
            const filled = val / 10
            return (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                  <span style={{ fontSize: 12, color: 'var(--foreground)', fontWeight: 500 }}>Elite Performance Rate</span>
                  <span style={{ fontSize: 16, fontWeight: 700, color: rateColor(val, 5, 35) }}>{val.toFixed(0)}%</span>
                </div>
                <div style={{ display: 'flex', gap: 2 }}>
                  {Array.from({ length: 10 }, (_, i) => {
                    const opacity = filled >= i + 1 ? 1 : filled > i ? filled - i : 0
                    return <div key={i} style={{ flex: 1, height: 6, borderRadius: 2, background: opacity > 0 ? rateColor((i + 0.5) * 10, 5, 35) : 'var(--border)', opacity: opacity > 0 && opacity < 1 ? 0.5 + opacity * 0.5 : 1 }} />
                  })}
                </div>
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}

function PeerComparisonSideBySide({ playerA, playerB }: { playerA: PlayerData; playerB: PlayerData }) {
  const posLabel = POSITION_LABELS[playerA.player.position ?? ''] ?? playerA.player.position ?? 'Players'
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Peer Comparison
          <span className="ml-2 text-sm font-normal text-muted-foreground">— {posLabel}</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 sm:grid-cols-2 sm:gap-6">
          <div>
            <div className="mb-2 text-sm font-semibold sm:mb-3">{playerA.player.name}</div>
            <PeerCard data={playerA} />
          </div>
          <div>
            <div className="mb-2 text-sm font-semibold sm:mb-3">{playerB.player.name}</div>
            <PeerCard data={playerB} />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function PlayerSelector({ label, search, results, selected, onSearch, onSelect, onSeasonChange, color }: {
  label: string; search: string; results: Player[]; selected: PlayerData | null
  onSearch: (v: string) => void; onSelect: (p: Player) => void; onSeasonChange: (s: string) => void; color: string
}) {
  return (
    <div className="relative">
      <label className="mb-2 block text-sm font-semibold" style={{ color }}>{label}</label>
      <Input placeholder="Search player name..." value={search} onChange={(e) => onSearch(e.target.value)} className="bg-secondary" />
      {results.length > 0 && (
        <div className="absolute top-full z-50 mt-1 w-full rounded-md border border-border bg-card shadow-lg max-h-60 overflow-y-auto">
          {results.map((p) => (
            <button key={p.id} onClick={() => onSelect(p)} className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-accent">
              <span className="font-medium">{p.name}</span>
              <span className="text-xs text-muted-foreground">{p.position} · {(p.team as any)?.name}</span>
            </button>
          ))}
        </div>
      )}
      {selected && (
        <div className="mt-2 rounded-lg border border-border bg-card/50 p-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="font-semibold">{selected.player.name}</div>
              <div className="text-xs text-muted-foreground">{selected.player.position} · {(selected.player.team as any)?.name}</div>
            </div>
            {selected.seasons.length > 0 && (
              <select
                value={selected.season}
                onChange={(e) => onSeasonChange(e.target.value)}
                className="rounded-lg border border-border bg-card px-2 py-1.5 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {selected.seasons.map((s) => (
                  <option key={`${s.league_id}-${s.season}`} value={`${s.league_id}|${s.season}`}>
                    {s.league_name} {s.season}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
