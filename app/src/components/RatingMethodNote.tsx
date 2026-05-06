import { ChevronDown, Info } from 'lucide-react'

interface Props {
  variant: 'forward' | 'winger' | 'attacking-midfielder' | 'midfielder' | 'defender'
}

const NOTES: Record<Props['variant'], { title: string; measured: string[]; limits: string[] }> = {
  forward: {
    title: 'What this forward rating means',
    measured: [
      'Finishing: goals versus chance quality, shot execution, non-penalty xG signals',
      'Shot generation: shots, self-created shots, shot accuracy, and threat volume',
      'Chance creation: xA, key passes, big chances created, assists',
      'Link play: touches, pass security, involvement, carrying, duels, recoveries',
      'Discipline and mistakes: cards, errors, penalties won, and result context where configured',
    ],
    limits: [
      'Decoy runs, pinning defenders, pressing traps, and occupation of centre-backs are only partly visible',
      'A striker can improve team spacing without receiving a direct event credit',
      'Role differences between target men, runners, and false nines still need human interpretation',
    ],
  },
  winger: {
    title: 'What this wide-player rating means',
    measured: [
      '1v1 threat: dribble success, failed dribbles, carries, fouls won',
      'Chance creation: xA, key passes, big chances, crossing and final-ball output',
      'End product: goals, assists, shot quality, shot volume',
      'Defensive work: recoveries, tackles, duels, and tracking-event proxies',
      'Ball security: touches, possession losses, pass security, progressive carrying',
    ],
    limits: [
      'Width holding, off-ball runs, double-team gravity, and defensive positioning are only partly captured',
      'Cross quality depends heavily on teammate movement and box occupation',
      'Team style can inflate or suppress wide-player event volume',
    ],
  },
  'attacking-midfielder': {
    title: 'What this attacking-midfielder rating means',
    measured: [
      'Creation: xA, key passes, big chances, assists, and pre-assist context where available',
      'Goal threat: shots, xG, finishing, box entries by proxy',
      'Connective play: pass security, touches, team-function involvement',
      'Carrying: progressive carries, dribbles, fouls won, retention',
      'Defensive contribution: recoveries, tackles, interceptions, pressure-event proxies',
    ],
    limits: [
      'Scanning, receiving between lines, disguise, tempo control, and manipulation of defenders are only partly visible',
      'A creator can make the right pass before the assist without always getting a direct event reward',
      'Role differences between a classic 10, second striker, and wide creator need context',
    ],
  },
  midfielder: {
    title: 'What this midfielder rating means',
    measured: [
      'Passing value: pass impact, progression, long balls, opposition-half passing',
      'Carrying: progressive carry distance, dribbles, fouls won, retention',
      'Chance creation and box threat: xA, key passes, shots, xG',
      'Defensive coverage: recoveries, tackles, interceptions, duels',
      'Security and discipline: possession losses, errors, cards',
    ],
    limits: [
      'Positioning, availability between lines, tempo-setting, pressing cover, and rest-defense shape are only partly visible',
      'Midfield roles vary heavily, so peer role/archetype context matters',
      'Team possession structure can make some midfielders look quieter or busier than their real influence',
    ],
  },
  defender: {
    title: 'What this defender rating means',
    measured: [
      'Box defending: clearances, blocks, interceptions, recoveries, tackles',
      'Duel security: aerial and ground contest outcomes',
      'Ball security: passing, touches, possession losses, long balls',
      'Build-up value: pass value, opposition-half passes, progressive carrying',
      'Direct mistakes and context: errors, cards, penalties conceded, own goals, clean sheets, small result/context effects',
    ],
    limits: [
      'Off-ball positioning, marking, line control, communication, and covering runs are not fully visible in event data',
      'Shared responsibility for goals is only lightly captured unless a formal error is logged',
      'Team style can affect volume: low-block defenders may record more defensive actions than proactive high-line defenders',
    ],
  },
}

export default function RatingMethodNote({ variant }: Props) {
  const note = NOTES[variant]

  return (
    <details className="group mt-4 border border-border bg-muted/30">
      <summary className="flex cursor-pointer list-none items-center gap-2 p-4 text-sm font-semibold text-foreground transition-colors hover:bg-muted/40 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
        <Info className="h-4 w-4 text-primary" aria-hidden="true" />
        <span>{note.title}</span>
        <ChevronDown
          className="ml-auto h-4 w-4 text-muted-foreground transition-transform duration-200 group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <div className="grid gap-4 border-t border-border px-4 pb-4 pt-3 text-xs leading-relaxed text-muted-foreground md:grid-cols-2">
        <div>
          <div className="mb-2 font-semibold uppercase tracking-wider text-foreground/80">Measured</div>
          <ul className="space-y-1.5">
            {note.measured.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <div>
          <div className="mb-2 font-semibold uppercase tracking-wider text-foreground/80">Not fully captured</div>
          <ul className="space-y-1.5">
            {note.limits.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </div>
    </details>
  )
}
