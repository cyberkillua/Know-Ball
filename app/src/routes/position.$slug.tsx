import { createFileRoute, Link } from '@tanstack/react-router'
import { Lock } from 'lucide-react'

export const Route = createFileRoute('/position/$slug')({ component: ComingSoonPage })

const POSITION_INFO: Record<string, { name: string; abbr: string; description: string }> = {
  cb: {
    name: 'Centre-Backs',
    abbr: 'CB',
    description:
      'Defensive rating system covering aerial dominance, tackles, interceptions, progressive passing, and composure under pressure.',
  },
  cm: {
    name: 'Midfielders',
    abbr: 'CM',
    description:
      'Midfield rating engine measuring passing accuracy, chance creation, ball retention, pressing intensity, and defensive contribution.',
  },
  winger: {
    name: 'Wingers',
    abbr: 'LW/RW',
    description:
      'Wide player ratings tracking dribbling success, crossing quality, goal threat, defensive tracking, and progressive carries.',
  },
  gk: {
    name: 'Goalkeepers',
    abbr: 'GK',
    description:
      'Goalkeeper rating system analysing save percentage, distribution accuracy, cross claiming, sweeper actions, and post-shot xG prevented.',
  },
}

function ComingSoonPage() {
  const { slug } = Route.useParams()
  const info = POSITION_INFO[slug]

  if (!info) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <p className="text-muted-foreground">Position not found.</p>
        <Link to="/" className="mt-4 text-sm text-primary no-underline hover:underline">
          Back to Strikers
        </Link>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-primary/10 border border-primary/20 mb-6">
        <span className="text-2xl font-extrabold text-primary">{info.abbr}</span>
      </div>

      <div className="flex items-center gap-2 mb-3">
        <Lock className="h-4 w-4 text-muted-foreground" />
        <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Coming Soon</span>
      </div>

      <h1 className="text-3xl font-extrabold tracking-tight text-foreground">{info.name}</h1>

      <p className="mt-4 max-w-md text-sm leading-relaxed text-muted-foreground">{info.description}</p>

      <div className="mt-8 rounded-xl border border-border bg-card p-6 max-w-sm">
        <h3 className="text-sm font-semibold text-foreground mb-2">What to expect</h3>
        <ul className="space-y-2 text-left text-xs text-muted-foreground">
          <li className="flex items-start gap-2">
            <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
            Position-specific rating categories and weights
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
            Per-match ratings across 6 leagues
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
            Peer comparison and percentile rankings
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
            Season trends and form analysis
          </li>
        </ul>
      </div>

      <Link
        to="/"
        className="mt-8 inline-flex items-center gap-2 rounded-lg bg-primary/10 px-4 py-2 text-sm font-medium text-primary no-underline hover:bg-primary/20 transition-colors"
      >
        View Striker Ratings
      </Link>
    </div>
  )
}
