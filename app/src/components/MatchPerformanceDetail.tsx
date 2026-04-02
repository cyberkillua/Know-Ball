import { Link } from '@tanstack/react-router'
import { MiniCategoryBarsLabeled } from './MiniCategoryBars'
import type { MatchPlayerStats } from '../lib/types'

interface Props {
  stats: MatchPlayerStats
  playerId: number
  playerName: string
  /** Normalized category scores from match_ratings */
  categories: {
    finishing: number
    involvement: number
    carrying: number
    physical: number
    pressing: number
  }
}

function StatBox({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card/50 p-2 text-center">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-base font-bold tabular-nums" style={color ? { color } : undefined}>
        {value}
      </div>
    </div>
  )
}

function SectionLabel({ children }: { children: string }) {
  return (
    <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
      {children}
    </div>
  )
}

export default function MatchPerformanceDetail({ stats, playerId, playerName, categories }: Props) {
  const passAccuracy =
    stats.passes_total > 0
      ? Math.round((stats.passes_completed / stats.passes_total) * 100)
      : 0

  const crossAccuracy =
    stats.total_cross > 0
      ? `${stats.accurate_cross}/${stats.total_cross}`
      : '—'

  const longBallAccuracy =
    stats.total_long_balls > 0
      ? `${stats.accurate_long_balls}/${stats.total_long_balls}`
      : '—'

  const hasDisciplineEvent =
    (stats.yellow_cards ?? 0) > 0 ||
    (stats.red_cards ?? 0) > 0 ||
    (stats.own_goals ?? 0) > 0 ||
    (stats.error_lead_to_goal ?? 0) > 0 ||
    (stats.error_lead_to_shot ?? 0) > 0

  return (
    <div className="mt-3 space-y-4 border-t border-border pt-3">

      {/* Key outputs */}
      <div className="grid grid-cols-4 gap-2">
        <StatBox label="Goals" value={stats.goals} color="var(--cat-finishing)" />
        <StatBox label="Assists" value={stats.assists} color="var(--cat-involvement)" />
        <StatBox label="xG" value={Number(stats.xg).toFixed(2)} color="var(--cat-finishing)" />
        <StatBox label="xGOT" value={Number(stats.xgot).toFixed(2)} color="var(--cat-finishing)" />
      </div>

      {/* Shooting */}
      <div>
        <SectionLabel>Shooting</SectionLabel>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          <StatBox label="Shots" value={stats.shots_total} />
          <StatBox label="On Target" value={stats.shots_on_target} />
          <StatBox label="Off Target" value={stats.shots_off_target} />
          <StatBox label="Big Chance Missed" value={stats.big_chance_missed ?? 0} />
          <StatBox label="Hit Woodwork" value={stats.hit_woodwork ?? 0} />
          <StatBox label="Blocked" value={stats.blocked_scoring_attempt ?? 0} />
        </div>
      </div>

      {/* Passing & Creativity */}
      <div>
        <SectionLabel>Passing & Creativity</SectionLabel>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          <StatBox label="Passes" value={`${stats.passes_completed}/${stats.passes_total}`} />
          <StatBox label="Pass %" value={`${passAccuracy}%`} />
          <StatBox label="Key Passes" value={stats.key_passes} color="var(--cat-involvement)" />
          <StatBox label="Big Chance Created" value={stats.big_chance_created ?? 0} color="var(--cat-involvement)" />
          <StatBox label="Crosses" value={crossAccuracy} />
          <StatBox label="Long Balls" value={longBallAccuracy} />
        </div>
      </div>

      {/* Carrying */}
      <div>
        <SectionLabel>Carrying</SectionLabel>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          <StatBox label="Dribbles" value={stats.successful_dribbles} color="var(--cat-carrying)" />
          <StatBox label="Drib. Failed" value={stats.failed_dribbles} />
          <StatBox label="Touches" value={stats.touches} />
          <StatBox label="Fouls Won" value={stats.fouls_won} />
          <StatBox label="Penalty Won" value={stats.penalty_won ?? 0} color="var(--cat-carrying)" />
          <StatBox label="Poss. Lost" value={stats.possession_lost_ctrl ?? 0} />
        </div>
      </div>

      {/* Duels */}
      <div>
        <SectionLabel>Duels</SectionLabel>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatBox label="Ground Duels" value={`${stats.ground_duels_won}/${stats.ground_duels_won + stats.ground_duels_lost}`} />
          <StatBox label="Aerial Duels" value={`${stats.aerial_duels_won}/${stats.aerial_duels_won + stats.aerial_duels_lost}`} color="var(--cat-physical)" />
          <StatBox label="Tackles Won" value={stats.tackles_won} color="var(--cat-pressing)" />
          <StatBox label="Interceptions" value={stats.interceptions} color="var(--cat-pressing)" />
        </div>
      </div>

      {/* Defense */}
      <div>
        <SectionLabel>Defense</SectionLabel>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          <StatBox label="Clearances" value={stats.clearances ?? 0} />
          <StatBox label="Ball Recovery" value={stats.ball_recovery ?? 0} />
          <StatBox label="Blocks" value={stats.outfielder_block ?? 0} />
          <StatBox label="Minutes" value={stats.minutes_played} />
        </div>
      </div>

      {/* Discipline — only shown if something happened */}
      {hasDisciplineEvent && (
        <div>
          <SectionLabel>Discipline</SectionLabel>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {(stats.yellow_cards ?? 0) > 0 && (
              <StatBox label="Yellow Card" value={stats.yellow_cards ?? 0} color="#FACC15" />
            )}
            {(stats.red_cards ?? 0) > 0 && (
              <StatBox label="Red Card" value={stats.red_cards ?? 0} color="var(--cat-finishing)" />
            )}
            {(stats.own_goals ?? 0) > 0 && (
              <StatBox label="Own Goal" value={stats.own_goals ?? 0} color="var(--cat-finishing)" />
            )}
            {(stats.error_lead_to_goal ?? 0) > 0 && (
              <StatBox label="Error → Goal" value={stats.error_lead_to_goal ?? 0} color="var(--cat-finishing)" />
            )}
            {(stats.error_lead_to_shot ?? 0) > 0 && (
              <StatBox label="Error → Shot" value={stats.error_lead_to_shot ?? 0} />
            )}
          </div>
        </div>
      )}

      {/* Derived category scores */}
      <div className="rounded-lg border border-border bg-card/50 p-3">
        <div className="mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Derived Ratings</div>
        <MiniCategoryBarsLabeled
          finishing={categories.finishing}
          involvement={categories.involvement}
          carrying={categories.carrying}
          physical={categories.physical}
          pressing={categories.pressing}
        />
      </div>

      {/* View Full Profile link */}
      <div className="flex justify-end">
        <Link
          to="/player/$id"
          params={{ id: String(playerId) }}
          className="text-xs font-medium text-primary hover:underline"
        >
          View Full Profile for {playerName} &rarr;
        </Link>
      </div>
    </div>
  )
}
