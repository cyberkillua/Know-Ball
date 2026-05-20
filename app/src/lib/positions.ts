export const POSITION_GROUPS = [
  { value: 'forwards', label: 'Forwards' },
  { value: 'wingers', label: 'Wingers' },
  { value: 'attacking_midfielders', label: 'Attacking Midfielders' },
  { value: 'midfielders', label: 'Midfielders' },
  { value: 'centre_backs', label: 'Centre-Backs' },
  { value: 'fullbacks', label: 'Fullbacks' },
  { value: 'goalkeepers', label: 'Goalkeepers' },
] as const

export type PositionGroup = (typeof POSITION_GROUPS)[number]['value']

const POSITION_GROUP_LABELS = new Map(POSITION_GROUPS.map((group) => [group.value, group.label]))

export function getPositionGroupLabel(group: string) {
  return POSITION_GROUP_LABELS.get(group as PositionGroup) ?? group
}

// Maps UI position groups to the rating codes stored in peer_ratings.position
// (see pipeline/model/compute.py — labels written by the rating engine).
export const POSITION_GROUP_TO_RATING_CODES: Record<PositionGroup, string[]> = {
  forwards: ['ST'],
  wingers: ['WINGER'],
  attacking_midfielders: ['CAM'],
  midfielders: ['CM'],
  centre_backs: ['CB', 'DEF'],
  fullbacks: ['FB'],
  goalkeepers: ['GK'],
}

const RATING_CODE_TO_POSITION_GROUP: Record<string, PositionGroup> = Object.entries(
  POSITION_GROUP_TO_RATING_CODES,
).reduce((acc, [group, codes]) => {
  for (const code of codes) acc[code] = group as PositionGroup
  return acc
}, {} as Record<string, PositionGroup>)

export function ratingCodeToPositionGroup(code: string | null | undefined): PositionGroup | null {
  if (!code) return null
  return RATING_CODE_TO_POSITION_GROUP[code] ?? null
}

export function positionGroupSql(alias = 'p') {
  return `CASE
    WHEN UPPER(TRIM(${alias}.position)) IN ('ST', 'CF', 'SS', 'FW', 'F', 'FORWARD', 'STRIKER') THEN 'forwards'
    WHEN UPPER(TRIM(${alias}.position)) IN ('LW', 'RW', 'LM', 'RM', 'W', 'WINGER') THEN 'wingers'
    WHEN UPPER(TRIM(${alias}.position)) IN ('CAM', 'AM') THEN 'attacking_midfielders'
    WHEN UPPER(TRIM(${alias}.position)) IN ('CM', 'CDM', 'DM', 'MID', 'M', 'MIDFIELDER') THEN 'midfielders'
    WHEN UPPER(TRIM(${alias}.position)) IN ('CB', 'DEF', 'D', 'DEFENDER') THEN 'centre_backs'
    WHEN UPPER(TRIM(${alias}.position)) IN ('LB', 'RB', 'LWB', 'RWB') THEN 'fullbacks'
    WHEN UPPER(TRIM(${alias}.position)) IN ('GK', 'G', 'GOALKEEPER') THEN 'goalkeepers'
    ELSE NULL
  END`
}
