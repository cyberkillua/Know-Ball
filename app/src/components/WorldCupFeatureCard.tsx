import { Link } from '@tanstack/react-router'
import { ArrowRight, Globe2, Trophy } from 'lucide-react'

export default function WorldCupFeatureCard() {
  return (
    <Link
      to="/world-cup"
      className="group relative block overflow-hidden border border-primary/45 bg-card p-5 no-underline sm:p-7"
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_85%_15%,rgba(254,220,151,0.16),transparent_32%),linear-gradient(135deg,rgba(40,102,110,0.2),transparent_55%)]" />
      <Globe2 className="absolute -bottom-12 -right-8 h-52 w-52 text-primary/[0.05] transition-transform duration-500 group-hover:scale-105" />

      <div className="relative flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-2xl">
          <div className="mb-4 flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 bg-primary px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-[0.2em] text-primary-foreground">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary-foreground" />
              Live Tournament
            </span>
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              11 Jun - 19 Jul
            </span>
          </div>

          <div className="flex items-center gap-3">
            <Trophy className="h-8 w-8 text-primary" />
            <h2 className="text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
              2026 WC
            </h2>
          </div>
          <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground sm:text-base">
            Follow every match, discover the tournament's standout players, and
            see how all 48 nations perform through the Know Ball lens.
          </p>
        </div>

        <span className="inline-flex w-fit items-center gap-2 border border-primary/50 bg-primary/10 px-4 py-2.5 text-sm font-bold text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
          Enter World Cup
          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
        </span>
      </div>
    </Link>
  )
}
