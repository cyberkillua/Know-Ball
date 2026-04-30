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
