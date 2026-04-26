export const POSITION_GROUPS = [
  { value: 'forwards', label: 'Forwards' },
  { value: 'attacking_midfielders', label: 'Attacking Midfielders' },
  { value: 'midfielders', label: 'Midfielders' },
  { value: 'defenders', label: 'Defenders' },
  { value: 'goalkeepers', label: 'Goalkeepers' },
] as const

export type PositionGroup = (typeof POSITION_GROUPS)[number]['value']

const POSITION_GROUP_LABELS = new Map(POSITION_GROUPS.map((group) => [group.value, group.label]))

export function getPositionGroupLabel(group: string) {
  return POSITION_GROUP_LABELS.get(group as PositionGroup) ?? group
}

export function positionGroupSql(alias = 'p') {
  return `CASE
    WHEN UPPER(TRIM(${alias}.position)) IN ('ST', 'CF', 'SS', 'FW', 'F', 'FORWARD', 'STRIKER', 'LW', 'RW', 'W', 'WINGER') THEN 'forwards'
    WHEN UPPER(TRIM(${alias}.position)) IN ('CAM', 'AM') THEN 'attacking_midfielders'
    WHEN UPPER(TRIM(${alias}.position)) IN ('CM', 'CDM', 'DM', 'MID', 'M', 'MIDFIELDER', 'LM', 'RM') THEN 'midfielders'
    WHEN UPPER(TRIM(${alias}.position)) IN ('CB', 'LB', 'RB', 'LWB', 'RWB', 'DEF', 'D', 'DEFENDER') THEN 'defenders'
    WHEN UPPER(TRIM(${alias}.position)) IN ('GK', 'G', 'GOALKEEPER') THEN 'goalkeepers'
    ELSE NULL
  END`
}
