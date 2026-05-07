import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import type { RoleFitProfile, SimilarRoleProfile } from '../lib/types'

function confidenceShortLabel(level: RoleFitProfile['confidence']['level']) {
  if (level === 'high') return 'High'
  if (level === 'moderate') return 'Moderate'
  return 'Low'
}

function confidenceClass(level: RoleFitProfile['confidence']['level']) {
  if (level === 'high') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
  if (level === 'moderate') return 'border-amber-500/30 bg-amber-500/10 text-amber-300'
  return 'border-border bg-muted text-muted-foreground'
}

function fillToneClass(score: number) {
  if (score >= 75) return 'bg-emerald-500'
  if (score >= 55) return 'bg-amber-400'
  return 'bg-rose-500'
}

export default function RoleFitCard({
  roleFit,
  similarProfiles = [],
}: {
  roleFit: RoleFitProfile
  similarProfiles?: SimilarRoleProfile[]
}) {
  const [expanded, setExpanded] = useState(false)
  const primary = roleFit.primary
  const score = primary.score
  const alsoFits = roleFit.top.slice(1, 3)
  const fillPct = Math.max(0, Math.min(100, Math.round(score)))

  return (
    <Card className="lg:col-span-2">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Role Fit
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Hero row: role + score */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-lg font-bold leading-tight text-foreground sm:text-xl">
              {primary.label}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
              <span className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${confidenceClass(roleFit.confidence.level)}`}>
                {confidenceShortLabel(roleFit.confidence.level)}
              </span>
              <span>{roleFit.confidence.gap.toFixed(1)} pt gap to next fit</span>
            </div>
          </div>
          <div className="flex shrink-0 items-baseline gap-0.5">
            <span className="text-3xl font-bold leading-none tabular-nums text-foreground">
              {score.toFixed(0)}
            </span>
            <span className="text-xs text-muted-foreground">/100</span>
          </div>
        </div>

        {/* Fill bar */}
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full rounded-full transition-all ${fillToneClass(score)}`}
            style={{ width: `${fillPct}%` }}
          />
        </div>

        {/* Also fits — inline */}
        {alsoFits.length > 0 && (
          <div className="mt-3 text-xs text-muted-foreground">
            <span className="font-semibold uppercase tracking-wider text-muted-foreground">Also: </span>
            {alsoFits.map((fit, i) => (
              <span key={fit.key}>
                {i > 0 && <span className="text-muted-foreground/60">, </span>}
                <span className="text-foreground">{fit.label}</span>{' '}
                <span className="tabular-nums">{fit.score.toFixed(0)}</span>
              </span>
            ))}
          </div>
        )}

        {/* Plays like — collapsible */}
        {similarProfiles.length > 0 && (
          <div className="mt-4 border-t border-border pt-3">
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              className="flex w-full min-h-9 items-center justify-between gap-2 text-left transition-colors hover:text-foreground"
            >
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Plays like
              </span>
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="tabular-nums">{similarProfiles.length}</span>
                <ChevronDown
                  size={16}
                  className={`transition-transform ${expanded ? 'rotate-180' : ''}`}
                />
              </span>
            </button>
            {expanded && (
              <ul className="mt-3 divide-y divide-border/60">
                {similarProfiles.map((profile) => (
                  <li
                    key={`${profile.player_id}-${profile.season}-${profile.league_name}`}
                    className="flex min-w-0 items-center justify-between gap-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-foreground">
                        {profile.player_name}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {profile.league_name ?? 'League'} {profile.season}
                      </div>
                    </div>
                    <span className="shrink-0 text-base font-bold tabular-nums text-foreground">
                      {Math.round(profile.similarity)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
