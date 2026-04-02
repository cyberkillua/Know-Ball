import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState, useRef } from 'react'
import { domToPng } from 'modern-screenshot'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Skeleton } from '../components/ui/skeleton'
import RatingBadge from '../components/RatingBadge'
import RatingLineChart from '../components/charts/RatingLineChart'
import StatRow from '../components/StatRow'
import PizzaChart from '../components/charts/PizzaChart'
import {
  getPlayer,
  getPlayerSeasons,
  getPlayerRatings,
  getPlayerPeerRating,
  getPlayerStats,
  getPlayerShots,
  getPlayerXgotDelta,
} from '../lib/queries'
import type { Player, MatchRating, PeerRating, PlayerStats, Shot } from '../lib/types'
import ShotProfile from '../components/ShotProfile'

export const Route = createFileRoute('/player/$id')({ component: PlayerProfilePage })

const POSITION_LABELS: Record<string, string> = {
  ST: 'Strikers',
  CF: 'Centre-Forwards',
  LW: 'Left Wingers',
  RW: 'Right Wingers',
  CAM: 'Attacking Midfielders',
  CM: 'Central Midfielders',
  CDM: 'Defensive Midfielders',
  LB: 'Left Backs',
  RB: 'Right Backs',
  CB: 'Centre-Backs',
  GK: 'Goalkeepers',
}

// ── Stat helpers ──────────────────────────────────────────────────────────────
const fmt = (v: any, decimals = 2) => {
  if (v == null) return '—'
  const num = Number(v)
  if (isNaN(num)) return '—'
  return num.toFixed(decimals)
}
const fmtPct = (v: any) =>
  v != null ? `${Math.round(Number(v) * 100)}%` : '—'
const fmtSigned = (v: any) => {
  if (v == null) return '—'
  const n = Number(v)
  return n >= 0 ? `+${n.toFixed(2)}` : n.toFixed(2)
}

function calculateAge(dateOfBirth: string | null): number | null {
  if (!dateOfBirth) return null
  const dob = new Date(dateOfBirth)
  const today = new Date()
  let age = today.getFullYear() - dob.getFullYear()
  const monthDiff = today.getMonth() - dob.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
    age--
  }
  return age
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

function avgPercentile(...vals: (number | null | undefined)[]): number | undefined {
  const valid = vals.filter((v) => v != null) as number[]
  if (valid.length === 0) return undefined
  return Math.round(valid.reduce((s, v) => s + v, 0) / valid.length)
}

// Select percentile based on mode (per90 vs raw)
// Returns 0 if not qualified (under 300 mins) since percentiles require minimum playing time
function pct(per90Pct: number | null | undefined, rawPct: number | null | undefined, mode: 'per90' | 'raw', qualified: boolean): number {
  if (!qualified) return 0
  if (mode === 'raw') return rawPct ?? 0
  return per90Pct ?? 0
}


function PlayerProfilePage() {
  const { id } = Route.useParams()
  const [player, setPlayer] = useState<Player | null>(null)
  const [seasons, setSeasons] = useState<{ season: string; league_id: number; league_name: string; matches: number }[]>([])
  const [season, setSeason] = useState<string>('')
  const [ratings, setRatings] = useState<MatchRating[]>([])
  const [peerRating, setPeerRating] = useState<PeerRating | null>(null)
  const [allPeerRating, setAllPeerRating] = useState<PeerRating | null>(null)
  const [stats, setStats] = useState<PlayerStats | null>(null)
  const [shots, setShots] = useState<Shot[]>([])
  const [xgotDelta, setXgotDelta] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [seasonLoading, setSeasonLoading] = useState(false)
  const [peerScope, setPeerScope] = useState<'league' | 'all'>('league')
  const [statMode, setStatMode] = useState<'per90' | 'raw'>('per90')
  const [viewMode, setViewMode] = useState<'bars' | 'pizza'>('bars')
  const percentileCardRef = useRef<HTMLDivElement>(null)
  const [downloading, setDownloading] = useState(false)

  const handleDownloadPercentiles = async () => {
    if (!percentileCardRef.current || !player) return
    setDownloading(true)
    setShowDownloadMenu(false)

    // Temporarily show export element for capture
    const exportEl = exportRef.current
    exportEl.style.zIndex = '9999'
    exportEl.style.opacity = '1'

    // Wait for render
    await new Promise((r) => setTimeout(r, 100))

    try {
      const dataUrl = await domToPng(exportEl, {
        scale: 2,
        backgroundColor: '#0a0a0a',
      })

      const link = document.createElement('a')
      link.download = `${player.name.replace(/\s+/g, '_')}_percentiles_${statMode}_${viewMode}.png`
      link.href = dataUrl
      link.click()
    } catch (err) {
      console.error('Failed to capture screenshot:', err)
    } finally {
      exportEl.style.zIndex = '-1'
      exportEl.style.opacity = '0'
      setDownloading(false)
    }
  }

  // Load player info and available seasons
  useEffect(() => {
    const playerId = Number(id)
    setLoading(true)
    Promise.all([
      getPlayer({ data: { playerId } }),
      getPlayerSeasons({ data: { playerId } }),
    ]).then(([p, s]) => {
      setPlayer(p)
      setSeasons(s)
      if (s.length > 0) {
        const first = s[0]
        setSeason(`${first.league_id}|${first.season}`)
      }
    })
  }, [id])

  // Load season-specific data whenever the selected season changes
  useEffect(() => {
    if (!season) return
    const playerId = Number(id)
    const [leagueId, seasonStr] = season.split('|')
    setSeasonLoading(true)
    Promise.all([
      getPlayerRatings({ data: { playerId, season: seasonStr } }),
      getPlayerPeerRating({ data: { playerId, season: seasonStr, scope: 'league' } }),
      getPlayerPeerRating({ data: { playerId, season: seasonStr, scope: 'all' } }),
      getPlayerStats({ data: { playerId, season: seasonStr } }),
      getPlayerShots({ data: { playerId, season: seasonStr } }),
      getPlayerXgotDelta({ data: { playerId, season: seasonStr } }),
    ]).then(([r, pr, apr, st, sh, xgd]) => {
      setRatings(r)
      setPeerRating(pr as PeerRating | null)
      setAllPeerRating(apr as PeerRating | null)
      setStats(st as PlayerStats | null)
      setShots(sh as Shot[])
      const rawDelta = (xgd as any)?.delta
      setXgotDelta(rawDelta != null ? Number(rawDelta) : null)
      setLoading(false)
      setSeasonLoading(false)
    })
  }, [id, season])

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-36 rounded-xl" />
        <div className="grid gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-64 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      </div>
    )
  }

  if (!player) {
    return <div className="text-muted-foreground">Player not found.</div>
  }

  const avgRating =
    ratings.length > 0
      ? ratings.reduce((sum, r) => sum + Number(r.final_rating), 0) / ratings.length
      : 0

  const last5 = ratings.slice(-5)
  const last5Avg =
    last5.length > 0
      ? last5.reduce((s, r) => s + Number(r.final_rating), 0) / last5.length
      : 0
  const formDelta = avgRating > 0 ? last5Avg - avgRating : 0

  const contentClass = seasonLoading ? 'opacity-50 pointer-events-none transition-opacity' : ''

  const isST = player.position === 'ST' || player.position === 'CF'

  // Active peer rating based on scope
  const activePeerRating = peerScope === 'league' ? peerRating : allPeerRating
  const peerQualified = (stats?.minutes ?? 0) >= 300

  return (
    <div className="space-y-6">
      {/* ── Layer 1: Hero Header ─────────────────────────────────────────── */}
      <Card>
        <CardContent className="p-6">
          {/* Top row: avatar / name / season / rating */}
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/20 to-secondary text-2xl font-bold text-primary">
              {player.name.charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl font-bold">{player.name}</h1>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                {player.position && <span>{player.position}</span>}
                {player.team && (
                  <>
                    <span>·</span>
                    <span>{(player.team as any).name}</span>
                  </>
                )}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                {calculateAge(player.date_of_birth) != null && (
                  <span>{calculateAge(player.date_of_birth)} yrs</span>
                )}
                {player.nationality && (
                  <>
                    {calculateAge(player.date_of_birth) != null && <span>·</span>}
                    <span>{player.nationality}</span>
                  </>
                )}
                {(player.team as any)?.league?.name && (
                  <>
                    {(calculateAge(player.date_of_birth) != null || player.nationality) && <span>·</span>}
                    <span>{(player.team as any).league.name}</span>
                  </>
                )}
              </div>
            </div>

{/* Season selector */}
             {seasons.length > 0 && (
               <div className="flex flex-col items-end gap-1 shrink-0">
                 <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                   Season
                 </label>
                 <select
                   value={season}
                   onChange={(e) => setSeason(e.target.value)}
                   className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                 >
                   {seasons.map((s) => (
                     <option key={`${s.league_id}-${s.season}`} value={`${s.league_id}|${s.season}`}>
                       {s.league_name} {s.season}
                     </option>
                   ))}
                 </select>
               </div>
             )}

            <div className="text-center shrink-0">
              {avgRating > 0 && (
                <>
                  <div className="text-xs text-muted-foreground">Avg Rating</div>
                  <RatingBadge rating={Number(avgRating.toFixed(1))} size="lg" />
                  {last5.length >= 3 && (
                    <div
                      className={`mt-1 text-xs font-medium ${
                        formDelta > 0.2
                          ? 'text-emerald-400'
                          : formDelta < -0.2
                            ? 'text-red-400'
                            : 'text-muted-foreground'
                      }`}
                    >
                      {formDelta > 0.2
                        ? 'Trending Up'
                        : formDelta < -0.2
                          ? 'Trending Down'
                          : 'Steady'}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          
        </CardContent>
      </Card>

      {/* Season-filtered content */}
      <div className={contentClass}>

        {/* ── Detailed Stats — ST / CF only ─────────────────────────── */}
        {isST && stats ? (
          <>
            <Card className="mt-4" ref={percentileCardRef}>
              <CardContent className="p-6">
                {/* ── Header with toggles ───────────────────────────── */}
                <div style={{ marginBottom: 24 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--foreground)', marginBottom: 2 }}>
                          {player.name}
                        </h2>
                      </div>
                      <h3 style={{ fontSize: 14, fontWeight: 500, color: 'var(--foreground)', marginBottom: 4 }}>
                        Percentile rankings
                      </h3>
                      <p style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>
                        vs {POSITION_LABELS[player.position ?? 'ST'] ?? player.position ?? 'Strikers'} in {(player.team as any)?.league?.name ?? 'this league'}
                      </p>
                      <p style={{ fontSize: 11, color: 'var(--muted-foreground)', marginTop: 2 }}>
                        {stats.matches} apps · {stats.minutes?.toLocaleString() ?? 0} mins
                      </p>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {/* Stat mode toggle */}
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
                      {/* View mode toggle */}
                      <div className="flex rounded-lg border border-border bg-card p-0.5 text-xs font-medium">
                        <button
                          onClick={() => setViewMode('bars')}
                          className={`rounded-md px-3 py-1 transition-colors ${viewMode === 'bars' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                        >
                          Bars
                        </button>
                        <button
                          onClick={() => setViewMode('pizza')}
                          className={`rounded-md px-3 py-1 transition-colors ${viewMode === 'pizza' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                        >
                          Pizza
                        </button>
                      </div>
                      {/* Download button */}
                      <button
                        onClick={handleDownloadPercentiles}
                        disabled={downloading || !peerQualified}
                        className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-50"
                        title="Download as PNG"
                      >
                        {downloading ? (
                          <span style={{ fontSize: 11 }}>Downloading...</span>
                        ) : (
                          <>
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
                            <span>PNG</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                  {!peerQualified && (
                    <p style={{ fontSize: 12, color: 'var(--muted-foreground)', marginTop: 12 }}>
                      Limited game time — percentile data requires 300+ minutes played ({stats?.minutes ?? 0} mins)
                    </p>
                  )}
                </div>

                {!peerQualified && stats ? (
                  <div style={{ padding: '2rem', color: 'var(--muted-foreground)', fontSize: 14, textAlign: 'center' }}>
                    <p style={{ marginBottom: 8 }}>Limited game time</p>
                    <p style={{ fontSize: 12 }}>
                      Percentile rankings require 300+ minutes played.<br />
                      Current: {stats.minutes ?? 0} minutes
                    </p>
                  </div>
                ) : !peerQualified ? (
                  <div style={{ padding: '2rem', color: 'var(--muted-foreground)', fontSize: 14, textAlign: 'center' }}>
                    <p>No percentile data available for this season.</p>
                  </div>
                ) : viewMode === 'pizza' ? (
                  <div style={{ marginBottom: 24 }}>
                    <PizzaChart
                      data={peerQualified ? [
                        // Goalscoring
                        { label: statMode === 'per90' ? 'Goals/90' : 'Goals', percentile: pct(peerRating?.goals_per90_percentile, peerRating?.goals_raw_percentile, statMode, peerQualified) },
                        { label: statMode === 'per90' ? 'Shots/90' : 'Shots', percentile: pct(peerRating?.shots_per90_percentile, peerRating?.shots_raw_percentile, statMode, peerQualified) },
                        { label: statMode === 'per90' ? 'xG/90' : 'xG', percentile: pct(peerRating?.xg_per90_percentile, peerRating?.xg_raw_percentile, statMode, peerQualified) },
                        { label: 'SoT%', percentile: peerRating?.shot_on_target_percentile ?? 0 },
                        { label: 'xG/shot', percentile: peerRating?.xg_per_shot_percentile ?? 0 },
                        { label: 'Conv%', percentile: peerRating?.shot_conversion_percentile ?? 0 },
                        { label: statMode === 'per90' ? 'xGOT/90' : 'xGOT', percentile: pct(peerRating?.xgot_per90_percentile, peerRating?.xg_raw_percentile, statMode, peerQualified) },
                        { label: statMode === 'per90' ? 'BCM/90' : 'BCM', percentile: 100 - pct(peerRating?.big_chances_missed_percentile, peerRating?.big_chances_missed_raw_percentile, statMode, peerQualified) },
                        // Chance creation
                        { label: statMode === 'per90' ? 'xA/90' : 'xA', percentile: pct(peerRating?.xa_per90_percentile, peerRating?.xa_raw_percentile, statMode, peerQualified) },
                        { label: statMode === 'per90' ? 'Ast/90' : 'Ast', percentile: pct(peerRating?.assists_per90_percentile, peerRating?.assists_raw_percentile, statMode, peerQualified) },
                        { label: 'xG+xA', percentile: pct(peerRating?.xg_plus_xa_percentile, peerRating?.xg_raw_percentile, statMode, peerQualified) },
                        { label: statMode === 'per90' ? 'KP/90' : 'KP', percentile: pct(peerRating?.key_passes_per90_percentile, peerRating?.key_passes_raw_percentile, statMode, peerQualified) },
                        { label: statMode === 'per90' ? 'BCC/90' : 'BCC', percentile: pct(peerRating?.big_chances_created_percentile, peerRating?.big_chances_created_raw_percentile, statMode, peerQualified) },
                        { label: statMode === 'per90' ? 'Crs/90' : 'Crs', percentile: pct(peerRating?.accurate_cross_per90_percentile, peerRating?.accurate_cross_raw_percentile, statMode, peerQualified) },
                        // Ball carrying
                        { label: 'Drb%', percentile: peerRating?.dribble_success_percentile ?? 0 },
                        { label: statMode === 'per90' ? 'Drb/90' : 'Drb', percentile: pct(peerRating?.dribbles_per90_percentile, peerRating?.dribbles_raw_percentile, statMode, peerQualified) },
                        { label: statMode === 'per90' ? 'Fw/90' : 'Fw', percentile: pct(peerRating?.fouls_won_per90_percentile, peerRating?.fouls_won_raw_percentile, statMode, peerQualified) },
                        { label: statMode === 'per90' ? 'Tch/90' : 'Tch', percentile: pct(peerRating?.touches_per90_percentile, peerRating?.touches_raw_percentile, statMode, peerQualified) },
                        // Physical
                        { label: 'Air%', percentile: peerRating?.physical_percentile ?? 0 },
                        { label: statMode === 'per90' ? 'Air/90' : 'Air', percentile: pct(peerRating?.aerials_per90_percentile, peerRating?.aerials_won_raw_percentile, statMode, peerQualified) },
                        { label: 'Grd%', percentile: peerRating?.physical_percentile ?? 0 },
                        { label: statMode === 'per90' ? 'Grd/90' : 'Grd', percentile: pct(peerRating?.ground_duels_won_per90_percentile, peerRating?.ground_duels_won_raw_percentile, statMode, peerQualified) },
                        { label: statMode === 'per90' ? 'Cont/90' : 'Cont', percentile: pct(peerRating?.total_contest_per90_percentile, peerRating?.total_contests_raw_percentile, statMode, peerQualified) },
                        // Pressing
                        { label: statMode === 'per90' ? 'Rec/90' : 'Rec', percentile: pct(peerRating?.ball_recoveries_per90_percentile, peerRating?.ball_recoveries_raw_percentile, statMode, peerQualified) },
                        { label: statMode === 'per90' ? 'Tkl/90' : 'Tkl', percentile: pct(peerRating?.tackles_per90_percentile, peerRating?.tackles_raw_percentile, statMode, peerQualified) },
                        { label: statMode === 'per90' ? 'Int/90' : 'Int', percentile: pct(peerRating?.interceptions_per90_percentile, peerRating?.interceptions_raw_percentile, statMode, peerQualified) },
                      ] : []}
                    />
                  </div>
                ) : (
                  <>
                    {/* Goalscoring */}
                    <div style={{ marginBottom: 32 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                        <span style={{ fontSize: 15, fontWeight: 500, color: 'var(--foreground)' }}>Goalscoring</span>
                        {peerRating?.finishing_percentile != null && (
                          <span style={{ fontSize: 13, fontWeight: 500, padding: '3px 10px', borderRadius: 'var(--radius-md)', background: '#d4f0e2', color: '#0f6e56' }}>
                            {Math.round(avgPercentile(peerRating.finishing_percentile, peerRating.xg_overperformance_percentile, peerRating.shot_conversion_percentile) ?? 0)}
                          </span>
                        )}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '12px 24px' }}>
                        <StatRow label={statMode === 'per90' ? 'Goals per 90' : 'Goals'} value={statMode === 'per90' ? fmt(stats.goals_per90) : String(stats.goals ?? 0)} percentile={pct(peerRating?.goals_per90_percentile, peerRating?.goals_raw_percentile, statMode, peerQualified)} />
                        <StatRow label={statMode === 'per90' ? 'Shots per 90' : 'Shots'} value={statMode === 'per90' ? fmt(stats.shots_per90) : String(stats.shots ?? 0)} percentile={pct(peerRating?.shots_per90_percentile, peerRating?.shots_raw_percentile, statMode, peerQualified)} />
                        <StatRow label={statMode === 'per90' ? 'xG per 90' : 'xG'} value={statMode === 'per90' ? fmt(stats.xg_per90) : fmt(stats.xg)} percentile={pct(peerRating?.xg_per90_percentile, peerRating?.xg_raw_percentile, statMode, peerQualified)} />
                        <StatRow label="Shot on target %" value={fmtPct(stats.shot_on_target_rate)} percentile={peerQualified ? (peerRating?.shot_on_target_percentile ?? 0) : 0} />
                        <StatRow label="xG per shot" value={fmt(stats.xg_per_shot, 2)} percentile={peerQualified ? (peerRating?.xg_per_shot_percentile ?? 0) : 0} />
                        <StatRow label="Shot conversion %" value={fmtPct(stats.shot_conversion_rate)} percentile={peerQualified ? (peerRating?.shot_conversion_percentile ?? 0) : 0} />
                        <StatRow label={statMode === 'per90' ? 'xGOT per 90' : 'xGOT'} value={statMode === 'per90' ? fmt(stats.xgot_per90) : fmt(stats.xg)} percentile={pct(peerRating?.xgot_per90_percentile, peerRating?.xg_raw_percentile, statMode, peerQualified)} />
                        <StatRow label={statMode === 'per90' ? 'Big chances missed / 90' : 'Big chances missed'} value={statMode === 'per90' ? fmt(stats.big_chances_missed_per90) : String(stats.big_chances_missed ?? 0)} percentile={pct(peerRating?.big_chances_missed_percentile, peerRating?.big_chances_missed_raw_percentile, statMode, peerQualified)} />
                      </div>
                    </div>

                    {/* Chance Creation */}
                    <div style={{ marginBottom: 32 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                        <span style={{ fontSize: 15, fontWeight: 500, color: 'var(--foreground)' }}>Chance creation</span>
                        {peerRating?.involvement_percentile != null && (
                          <span style={{ fontSize: 13, fontWeight: 500, padding: '3px 10px', borderRadius: 'var(--radius-md)', background: '#e6f1fb', color: '#185fa5' }}>
                            {Math.round(avgPercentile(peerRating.involvement_percentile, peerRating.xg_plus_xa_percentile) ?? 0)}
                          </span>
                        )}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '12px 24px' }}>
                        <StatRow label={statMode === 'per90' ? 'xA per 90' : 'xA'} value={statMode === 'per90' ? fmt(stats.xa_per90) : fmt(stats.xa)} percentile={pct(peerRating?.xa_per90_percentile, peerRating?.xa_raw_percentile, statMode, peerQualified)} />
                        <StatRow label={statMode === 'per90' ? 'Assists per 90' : 'Assists'} value={statMode === 'per90' ? fmt(stats.assists_per90) : String(stats.assists ?? 0)} percentile={pct(peerRating?.assists_per90_percentile, peerRating?.assists_raw_percentile, statMode, peerQualified)} />
                        <StatRow label={statMode === 'per90' ? 'xG + xA per 90' : 'xG + xA'} value={statMode === 'per90' ? fmt(stats.xg_plus_xa_per90) : fmt((Number(stats.xg) || 0) + (Number(stats.xa) || 0))} percentile={pct(peerRating?.xg_plus_xa_percentile, peerRating?.xg_raw_percentile, statMode, peerQualified)} />
                        <StatRow label={statMode === 'per90' ? 'Key passes per 90' : 'Key passes'} value={statMode === 'per90' ? fmt(stats.key_passes_per90) : String(stats.key_passes ?? 0)} percentile={pct(peerRating?.key_passes_per90_percentile, peerRating?.key_passes_raw_percentile, statMode, peerQualified)} />
                        <StatRow label={statMode === 'per90' ? 'Big chances created / 90' : 'Big chances created'} value={statMode === 'per90' ? fmt(stats.big_chance_created_per90 ?? stats.big_chances_created_per90) : String(stats.big_chances_created ?? 0)} percentile={pct(peerRating?.big_chances_created_percentile, peerRating?.big_chances_created_raw_percentile, statMode, peerQualified)} />
                        <StatRow label={statMode === 'per90' ? 'Accurate crosses / 90' : 'Accurate crosses'} value={statMode === 'per90' ? fmt(stats.accurate_cross_per90) : String(stats.accurate_cross ?? 0)} percentile={pct(peerRating?.accurate_cross_per90_percentile, peerRating?.accurate_cross_raw_percentile, statMode, peerQualified)} />
                      </div>
                    </div>

                    {/* Ball Carrying */}
                    <div style={{ marginBottom: 32 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                        <span style={{ fontSize: 15, fontWeight: 500, color: 'var(--foreground)' }}>Ball carrying</span>
                        {peerRating?.carrying_percentile != null && (
                          <span style={{ fontSize: 13, fontWeight: 500, padding: '3px 10px', borderRadius: 'var(--radius-md)', background: '#eeedfe', color: '#534ab7' }}>
                            {Math.round(peerRating.carrying_percentile)}
                          </span>
                        )}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '12px 24px' }}>
                        <StatRow label="Dribble success %" value={fmtPct(stats.dribble_success_rate)} percentile={peerQualified ? (peerRating?.dribble_success_percentile ?? 0) : 0} />
                        <StatRow label={statMode === 'per90' ? 'Successful dribbles / 90' : 'Successful dribbles'} value={statMode === 'per90' ? fmt(stats.dribbles_per90) : String(stats.dribbles ?? 0)} percentile={pct(peerRating?.dribbles_per90_percentile, peerRating?.dribbles_raw_percentile, statMode, peerQualified)} />
                        <StatRow label={statMode === 'per90' ? 'Fouls won / 90' : 'Fouls won'} value={statMode === 'per90' ? fmt(stats.fouls_won_per90) : String(stats.fouls_won ?? 0)} percentile={pct(peerRating?.fouls_won_per90_percentile, peerRating?.fouls_won_raw_percentile, statMode, peerQualified)} />
                        <StatRow label="Possession loss rate" value={fmtPct(stats.possession_loss_rate)} percentile={peerQualified ? (100 - (peerRating?.carrying_percentile ?? 0)) : 0} />
                        <StatRow label={statMode === 'per90' ? 'Touches per 90' : 'Touches'} value={statMode === 'per90' ? fmt(stats.touches_per90) : String(stats.touches ?? 0)} percentile={pct(peerRating?.touches_per90_percentile, peerRating?.touches_raw_percentile, statMode, peerQualified)} />
                        <StatRow label="Penalties won" value={String(stats.penalties_won ?? 0)} percentile={peerQualified ? (peerRating?.carrying_percentile ?? 0) : 0} />
                      </div>
                    </div>

                    {/* Physical Duels */}
                    <div style={{ marginBottom: 32 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                        <span style={{ fontSize: 15, fontWeight: 500, color: 'var(--foreground)' }}>Physical duels</span>
                        {peerRating?.physical_percentile != null && (
                          <span style={{ fontSize: 13, fontWeight: 500, padding: '3px 10px', borderRadius: 'var(--radius-md)', background: '#faeeda', color: '#854f0b' }}>
                            {Math.round(peerRating.physical_percentile)}
                          </span>
                        )}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '12px 24px' }}>
                        <StatRow label="Aerial win %" value={fmtPct(stats.aerial_win_rate)} percentile={peerQualified ? (peerRating?.physical_percentile ?? 0) : 0} />
                        <StatRow label={statMode === 'per90' ? 'Aerial wins / 90' : 'Aerial wins'} value={statMode === 'per90' ? fmt(stats.aerials_per90) : String(stats.aerials_won ?? 0)} percentile={pct(peerRating?.aerials_per90_percentile, peerRating?.aerials_won_raw_percentile, statMode, peerQualified)} />
                        <StatRow label="Ground duel win %" value={fmtPct(stats.ground_duel_win_rate)} percentile={peerQualified ? (peerRating?.physical_percentile ?? 0) : 0} />
                        <StatRow label={statMode === 'per90' ? 'Ground duel wins / 90' : 'Ground duel wins'} value={statMode === 'per90' ? fmt(stats.ground_duels_won_per90) : String(stats.ground_duels_won ?? 0)} percentile={pct(peerRating?.ground_duels_won_per90_percentile, peerRating?.ground_duels_won_raw_percentile, statMode, peerQualified)} />
                        <StatRow label={statMode === 'per90' ? 'Total contests / 90' : 'Total contests'} value={statMode === 'per90' ? fmt(stats.total_contest_per90) : String((stats.aerials_won ?? 0) + (stats.aerials_lost ?? 0) + (stats.ground_duels_won ?? 0) + (stats.ground_duels_lost ?? 0))} percentile={pct(peerRating?.total_contest_per90_percentile, peerRating?.total_contests_raw_percentile, statMode, peerQualified)} />
                        <StatRow
                          label="Overall duel win %"
                          value={fmtPct(
                            stats.aerials_won != null && stats.ground_duels_won != null && stats.total_contest_per90 != null
                              ? (stats.aerials_won + stats.ground_duels_won) / Math.max(1, (stats.aerials_won + (stats.aerials_lost ?? 0) + stats.ground_duels_won + (stats.ground_duels_lost ?? 0)))
                              : null
                          )}
                          percentile={peerQualified ? (peerRating?.physical_percentile ?? 0) : 0}
                        />
                      </div>
                    </div>

                    {/* Pressing & Recovery */}
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                        <span style={{ fontSize: 15, fontWeight: 500, color: 'var(--foreground)' }}>Pressing & recovery</span>
                        {peerRating?.pressing_percentile != null && (
                          <span style={{ fontSize: 13, fontWeight: 500, padding: '3px 10px', borderRadius: 'var(--radius-md)', background: '#faece7', color: '#993c1d' }}>
                            {Math.round(peerRating.pressing_percentile)}
                          </span>
                        )}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '12px 24px' }}>
                        <StatRow label={statMode === 'per90' ? 'Ball recoveries / 90' : 'Ball recoveries'} value={statMode === 'per90' ? fmt(stats.ball_recovery_per90 ?? stats.ball_recoveries_per90) : String(stats.ball_recoveries ?? 0)} percentile={pct(peerRating?.ball_recoveries_per90_percentile, peerRating?.ball_recoveries_raw_percentile, statMode, peerQualified)} />
                        <StatRow label={statMode === 'per90' ? 'Tackles won / 90' : 'Tackles won'} value={statMode === 'per90' ? fmt(stats.tackles_per90) : String(stats.tackles ?? 0)} percentile={pct(peerRating?.tackles_per90_percentile, peerRating?.tackles_raw_percentile, statMode, peerQualified)} />
                        <StatRow label={statMode === 'per90' ? 'Interceptions / 90' : 'Interceptions'} value={statMode === 'per90' ? fmt(stats.interceptions_per90) : String(stats.interceptions ?? 0)} percentile={pct(peerRating?.interceptions_per90_percentile, peerRating?.interceptions_raw_percentile, statMode, peerQualified)} />
                        <StatRow label={statMode === 'per90' ? 'Fouls committed / 90' : 'Fouls committed'} value={statMode === 'per90' ? fmt(stats.fouls_committed_per90) : String(stats.fouls_committed ?? 0)} percentile={pct(100 - (peerRating?.pressing_percentile ?? 0), peerRating?.fouls_committed_raw_percentile, statMode, peerQualified)} />
                      </div>
                    </div>
                  </>
                )}
{/* ── Watermark ───────────────────────────── */}
<div style={{ marginTop: 20, paddingTop: 12, borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 10, color: 'var(--muted-foreground)' }}>
<span>{seasons.find(s => `${s.league_id}|${s.season}` === season)?.league_name} {seasons.find(s => `${s.league_id}|${s.season}` === season)?.season}</span>
<span style={{ fontWeight: 500 }}>Know Ball</span>
</div>
              </CardContent>
            </Card>

            {/* ── Peer Comparison ──────────────────────────────────────────── */}
            <Card className="mt-4">
              <CardContent className="p-6">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <span style={{ fontSize: 15, fontWeight: 500, color: 'var(--foreground)' }}>Peer comparison</span>
                  <div className="flex rounded-lg border border-border bg-card p-0.5 text-xs font-medium">
                    <button
                      onClick={() => setPeerScope('league')}
                      className={`rounded-md px-3 py-1 transition-colors ${peerScope === 'league' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                    >
                      This league
                  </button>
                  <button
                    onClick={() => setPeerScope('all')}
                    className={`rounded-md px-3 py-1 transition-colors ${peerScope === 'all' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    All leagues
                  </button>
                </div>
              </div>
              {activePeerRating == null || (activePeerRating.matches_played ?? 0) < 5 ? (
                <div style={{ fontSize: 13, color: 'var(--muted-foreground)', padding: '1rem 0' }}>
                  Percentile data requires 5+ appearances.
                  {activePeerRating ? ` ${5 - activePeerRating.matches_played} more to go.` : ''}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {([
                    { label: 'Overall rating', value: activePeerRating.overall_percentile },
                    { label: 'Finishing', value: activePeerRating.finishing_percentile },
                    { label: 'Involvement', value: activePeerRating.involvement_percentile },
                    { label: 'Carrying', value: activePeerRating.carrying_percentile },
                    { label: 'Physical', value: activePeerRating.physical_percentile },
                    { label: 'Pressing', value: activePeerRating.pressing_percentile },
                    { label: 'xG + xA / 90', value: activePeerRating.xg_plus_xa_percentile },
                    { label: 'Clinicality (vs xG)', value: activePeerRating.xg_overperformance_percentile },
                    { label: 'Shot conversion', value: activePeerRating.shot_conversion_percentile },
                    { label: 'Dribble success %', value: activePeerRating.dribble_success_percentile },
                  ] as { label: string; value: number | null }[]).map(({ label, value }) => {
                    const pct = value ?? 0
                    const barColor = pct >= 70 ? '#1d9e75' : pct >= 40 ? '#ef9f27' : '#e24b4a'
                    return (
                      <div
                        key={label}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '160px 1fr 40px',
                          gap: 12,
                          alignItems: 'center',
                        }}
                      >
                        <span style={{ fontSize: 13, color: 'var(--muted-foreground)' }}>{label}</span>
                        <div style={{ height: 6, background: 'var(--muted)', borderRadius: 3, overflow: 'hidden' }}>
                          <div
                            style={{
                              height: '100%',
                              width: `${pct}%`,
                              background: barColor,
                              borderRadius: 3,
                            }}
                          />
                        </div>
                        <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--foreground)', textAlign: 'right' }}>
                          {value != null ? ordinal(Math.round(value)) : '—'}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
          </>
        ) : (
          !isST && (
            <div style={{ padding: '2rem', color: 'var(--muted-foreground)', fontSize: 14 }}>
              Detailed stats coming soon for this position.
            </div>
          )
        )}

        {/* ── Shot Profile ─────────────────────────────────────────────────── */}
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Shot Profile</CardTitle>
          </CardHeader>
          <CardContent>
            <ShotProfile shots={shots} xgotDelta={xgotDelta} xgOverperformance={stats?.xg_overperformance} />
          </CardContent>
        </Card>

        {/* ── Rating History ───────────────────────────────────────────────── */}
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Rating History</CardTitle>
          </CardHeader>
          <CardContent>
            {ratings.length > 0 ? (
              <RatingLineChart ratings={ratings} />
            ) : (
              <p className="text-sm text-muted-foreground">No rating data for this season.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
