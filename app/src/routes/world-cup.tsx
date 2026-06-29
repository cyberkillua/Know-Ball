import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, Flag, Globe2, Trophy, Users } from 'lucide-react'
import MatchCard from '../components/MatchCard'
import TrendingPlayerCard from '../components/TrendingPlayerCard'
import { Skeleton } from '../components/ui/skeleton'
import { getWorldCupOverview } from '../lib/queries'
import type { Match } from '../lib/types'

export const Route = createFileRoute('/world-cup')({ component: WorldCupPage })

type WorldCupData = Awaited<ReturnType<typeof getWorldCupOverview>>
type View = 'overview' | 'matches' | 'teams' | 'players'

const VIEWS: { value: View; label: string }[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'matches', label: 'Matches' },
  { value: 'teams', label: 'Teams' },
  { value: 'players', label: 'Players' },
]

function WorldCupPage() {
  const [data, setData] = useState<WorldCupData | null>(null)
  const [view, setView] = useState<View>('overview')

  useEffect(() => {
    getWorldCupOverview().then(setData)
  }, [])

  const completedMatches = useMemo(
    () => (data?.matches ?? []).filter((match) => match.home_score !== null) as Match[],
    [data],
  )

  if (!data) {
    return <WorldCupLoading />
  }

  const topPlayers = data.players.slice(0, view === 'overview' ? 5 : 50)

  return (
    <div className="space-y-8 pb-16">
      <section className="relative overflow-hidden border border-primary/45 bg-card px-5 py-8 sm:px-8 sm:py-10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_15%,rgba(254,220,151,0.18),transparent_28%),linear-gradient(135deg,rgba(40,102,110,0.25),transparent_60%)]" />
        <Globe2 className="absolute -bottom-20 -right-10 h-72 w-72 text-primary/[0.05]" />
        <div className="relative max-w-3xl">
          <span className="inline-flex items-center gap-2 bg-primary px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-[0.2em] text-primary-foreground">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary-foreground" />
            Tournament Live
          </span>
          <div className="mt-5 flex items-center gap-3">
            <Trophy className="h-9 w-9 text-primary" />
            <h1 className="text-4xl font-extrabold tracking-tight sm:text-6xl">2026 WC</h1>
          </div>
          <p className="mt-3 text-base text-muted-foreground sm:text-lg">
            United States · Canada · Mexico
          </p>
          <div className="mt-7 grid max-w-xl grid-cols-3 gap-px border border-border bg-border">
            <TournamentStat icon={Flag} value={data.teams.length || 48} label="Nations" />
            <TournamentStat icon={CalendarDays} value={completedMatches.length} label="Played" />
            <TournamentStat icon={Users} value={data.players.length} label="Rated" />
          </div>
        </div>
      </section>

      <nav className="flex gap-1 overflow-x-auto border-b border-border">
        {VIEWS.map((item) => (
          <button
            key={item.value}
            onClick={() => setView(item.value)}
            className={`border-b-2 px-4 py-3 text-sm font-bold transition-colors ${
              view === item.value
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {!data.league ? (
        <EmptyState
          title="World Cup data is ready to land"
          detail="Apply migration 053 and run the World Cup scraper to populate matches, teams, and player ratings."
        />
      ) : view === 'overview' ? (
        <div className="grid gap-8 lg:grid-cols-[1.25fr_0.75fr]">
          <section className="space-y-4">
            <SectionHeading title="Latest Matches" detail={`${completedMatches.length} completed`} />
            {completedMatches.length ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {completedMatches.slice(0, 6).map((match) => <MatchCard key={match.id} match={match} />)}
              </div>
            ) : (
              <EmptyState title="No matches yet" detail="Completed games will appear here after the next scrape." />
            )}
          </section>
          <section className="space-y-4">
            <SectionHeading title="Tournament Standouts" detail="Know Ball score" />
            <PlayerList players={topPlayers} />
          </section>
        </div>
      ) : view === 'matches' ? (
        <section className="space-y-4">
          <SectionHeading title="All Matches" detail={`${completedMatches.length} completed`} />
          {completedMatches.length ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {completedMatches.map((match) => <MatchCard key={match.id} match={match} />)}
            </div>
          ) : (
            <EmptyState title="No matches yet" detail="Completed games will appear here after the next scrape." />
          )}
        </section>
      ) : view === 'teams' ? (
        <section className="space-y-4">
          <SectionHeading title="Nations" detail={`${data.teams.length} tracked`} />
          {data.teams.length ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {data.teams.map((team) => (
                <Link
                  key={team.id}
                  to="/team/$id"
                  params={{ id: String(team.id) }}
                  className="border border-border bg-card p-4 no-underline transition-colors hover:border-primary/60"
                >
                  <div className="font-bold text-foreground">{team.name}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{team.matches_played} matches played</div>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState title="No nations yet" detail="Teams appear once World Cup matches have been scraped." />
          )}
        </section>
      ) : (
        <section className="space-y-4">
          <SectionHeading title="Top Players" detail={`${data.players.length} rated`} />
          <PlayerList players={topPlayers} />
        </section>
      )}
    </div>
  )
}

function PlayerList({ players }: { players: WorldCupData['players'] }) {
  if (!players.length) {
    return <EmptyState title="No player ratings yet" detail="Ratings appear after match processing and model computation." />
  }

  return (
    <div className="space-y-3">
      {players.map((entry, index) => (
        <Link key={entry.player_id} to="/player/$id" params={{ id: String(entry.player_id) }} className="block no-underline">
          <TrendingPlayerCard
            rank={index + 1}
            playerName={entry.player?.name ?? `Player ${entry.player_id}`}
            teamName={[entry.team?.name, entry.position].filter(Boolean).join(' · ')}
            rating={Number(entry.model_score ?? 0)}
          />
        </Link>
      ))}
    </div>
  )
}

function TournamentStat({ icon: Icon, value, label }: { icon: typeof Flag; value: number; label: string }) {
  return (
    <div className="bg-background/80 px-3 py-3 backdrop-blur-sm">
      <Icon className="mb-2 h-4 w-4 text-primary" />
      <div className="text-xl font-extrabold text-foreground">{value}</div>
      <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
    </div>
  )
}

function SectionHeading({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex items-end justify-between gap-4">
      <h2 className="text-xl font-extrabold tracking-tight">{title}</h2>
      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{detail}</span>
    </div>
  )
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="border border-dashed border-border bg-card/40 p-8 text-center">
      <Trophy className="mx-auto h-7 w-7 text-primary/60" />
      <div className="mt-3 font-bold text-foreground">{title}</div>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{detail}</p>
    </div>
  )
}

function WorldCupLoading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-72 w-full" />
      <Skeleton className="h-12 w-full" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-28" />)}
      </div>
    </div>
  )
}
