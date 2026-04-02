export interface League {
  id: number
  name: string
  country: string
  fotmob_id: number | null
  understat_slug: string | null
  tier: number
}

export interface Team {
  id: number
  name: string
  league_id: number
  fotmob_id: number | null
  understat_id: number | null
  logo_url: string | null
}

export interface Player {
  id: number
  name: string
  fotmob_id: number | null
  understat_id: number | null
  sofascore_id: number | null
  position: string | null
  nationality: string | null
  date_of_birth: string | null
  current_team_id: number | null
  photo_url: string | null
  height_cm: number | null
  preferred_foot: string | null
  shirt_number: number | null
  team?: Team & { league?: League }
}

export interface Match {
  id: number
  league_id: number
  season: string
  matchday: number | null
  date: string
  home_team_id: number
  away_team_id: number
  home_score: number | null
  away_score: number | null
  fotmob_id: number | null
  home_team?: Team
  away_team?: Team
}

export interface MatchPlayerStats {
  id: number
  match_id: number
  player_id: number
  team_id: number
  minutes_played: number
  position_played: string | null
  goals: number
  shots_total: number
  shots_on_target: number
  shots_off_target: number
  xg: number
  xgot: number
  assists: number
  xa: number
  key_passes: number
  touches: number
  passes_total: number
  passes_completed: number
  successful_dribbles: number
  failed_dribbles: number
  fouls_won: number
  aerial_duels_won: number
  aerial_duels_lost: number
  ground_duels_won: number
  ground_duels_lost: number
  tackles_won: number
  interceptions: number
  offsides: number
  fouls_committed: number
  yellow_cards: number
  red_cards: number
  sofascore_rating: number | null
  // Expanded passing stats
  total_cross: number
  accurate_cross: number
  total_long_balls: number
  accurate_long_balls: number
  big_chance_created: number
  // Expanded shooting stats
  big_chance_missed: number
  hit_woodwork: number
  blocked_scoring_attempt: number
  // Defensive stats
  clearances: number
  head_clearance: number
  outfielder_block: number
  ball_recovery: number
  // Errors
  error_lead_to_goal: number
  error_lead_to_shot: number
  // Possession
  possession_lost_ctrl: number
  total_contest: number
  // Other
  penalty_won: number
  penalty_conceded: number
  own_goals: number
  player?: Player
}

export interface MatchRating {
  id: number
  match_id: number
  player_id: number
  position: string
  finishing_raw: number
  involvement_raw: number
  carrying_raw: number
  physical_raw: number
  pressing_raw: number
  finishing_norm: number
  involvement_norm: number
  carrying_norm: number
  physical_norm: number
  pressing_norm: number
  final_rating: number
  fotmob_rating: number | null
  player?: Player
  match?: Match
}

export interface PeerRating {
  id: number
  player_id: number
  league_id: number
  season: string
  position: string
  // Per-90 base metrics
  goals_per90: number
  xa_per90: number
  xg_per90: number
  dribbles_per90: number
  aerial_wins_per90: number
  tackles_per90: number
  // Advanced derived metrics (v4)
  xg_plus_xa_per90: number | null
  xg_overperformance: number | null
  dribble_success_rate: number | null
  big_chances_created_per90: number | null
  shot_conversion_rate: number | null
  ball_recovery_per90: number | null
  xg_per_shot: number | null
  // Category percentiles
  goals_per90_percentile: number | null
  shots_per90_percentile: number | null
  xg_per90_percentile: number | null
  xgot_per90_percentile: number | null
  xg_per_shot_percentile: number | null
  shot_on_target_percentile: number | null
  big_chances_missed_percentile: number | null
  finishing_percentile: number | null
  involvement_percentile: number | null
  carrying_percentile: number | null
  physical_percentile: number | null
  pressing_percentile: number | null
  overall_percentile: number | null
  // Advanced percentiles (v4)
  xg_plus_xa_percentile: number | null
  xg_overperformance_percentile: number | null
  dribble_success_percentile: number | null
  shot_conversion_percentile: number | null
  big_chances_created_percentile: number | null
  // Chance creation percentiles
  xa_per90_percentile: number | null
  assists_per90_percentile: number | null
  key_passes_per90_percentile: number | null
  accurate_cross_per90_percentile: number | null
  // Ball carrying percentiles
  dribbles_per90_percentile: number | null
  touches_per90_percentile: number | null
  fouls_won_per90_percentile: number | null
  // Physical duels percentiles
  aerials_per90_percentile: number | null
  ground_duels_won_per90_percentile: number | null
  total_contest_per90_percentile: number | null
  // Pressing & recovery percentiles
  ball_recoveries_per90_percentile: number | null
  tackles_per90_percentile: number | null
  interceptions_per90_percentile: number | null
  // Raw percentiles (total stats)
  goals_raw_percentile: number | null
  assists_raw_percentile: number | null
  shots_raw_percentile: number | null
  xg_raw_percentile: number | null
  xa_raw_percentile: number | null
  key_passes_raw_percentile: number | null
  big_chances_created_raw_percentile: number | null
  big_chances_missed_raw_percentile: number | null
  accurate_cross_raw_percentile: number | null
  dribbles_raw_percentile: number | null
  fouls_won_raw_percentile: number | null
  touches_raw_percentile: number | null
  aerials_won_raw_percentile: number | null
  ground_duels_won_raw_percentile: number | null
  total_contests_raw_percentile: number | null
  tackles_raw_percentile: number | null
  interceptions_raw_percentile: number | null
  ball_recoveries_raw_percentile: number | null
  fouls_committed_raw_percentile: number | null
  // Metadata
  matches_played: number
  minutes_played: number
  avg_match_rating: number
}

export interface PlayerStats {
  matches: number
  starts: number
  sub_appearances: number
  minutes: number
  team_matches: number | null
  team_minutes_available: number | null
  // Goalscoring
  goals: number
  xg: number
  shots: number
  shots_on_target: number
  shots_off_target: number
  big_chances_missed: number
  hit_woodwork: number
  blocked_shots: number
  offsides: number
  penalties_won: number
  // Creativity
  assists: number
  xa: number
  key_passes: number
  big_chances_created: number
  total_cross: number
  accurate_cross: number
  total_long_balls: number
  accurate_long_balls: number
  passes_completed: number
  passes_total: number
  touches: number
  // Carrying
  dribbles: number
  dribbles_failed: number
  fouls_won: number
  possession_lost: number
  // Physical
  aerials_won: number
  aerials_lost: number
  ground_duels_won: number
  ground_duels_lost: number
  // Pressing
  tackles: number
  interceptions: number
  clearances: number
  ball_recoveries: number
  blocks: number
  errors_led_to_goal: number
  errors_led_to_shot: number
  // Discipline
  yellow_cards: number
  red_cards: number
  fouls_committed: number
  // Per 90
  goals_per90: number
  xg_per90: number
  shots_per90: number
  shots_on_target_per90: number
  big_chances_missed_per90: number
  assists_per90: number
  xa_per90: number
  key_passes_per90: number
  big_chances_created_per90: number
  dribbles_per90: number
  touches_per90: number
  tackles_per90: number
  interceptions_per90: number
  aerials_per90: number
  clearances_per90: number
  ball_recoveries_per90: number
  fouls_won_per90: number
  possession_lost_per90: number
  // Derived stats (v4)
  xg_per_shot: number | null
  shot_on_target_rate: number | null
  xg_overperformance: number | null
  xg_plus_xa_per90: number | null
  dribble_success_rate: number | null
  shot_conversion_rate: number | null
  aerial_win_rate: number | null
  ground_duel_win_rate: number | null
  possession_loss_rate: number | null
  xgot_per90: number | null
  ball_recovery_per90: number | null
  big_chance_created_per90: number | null
  accurate_cross_per90: number | null
  ground_duels_won_per90: number | null
  total_contest_per90: number | null
  fouls_committed_per90: number | null
}

export interface Shot {
  id: number
  match_id: number
  player_id: number
  minute: number
  x: number
  y: number
  xg: number
  result: string
  shot_type: string
  situation: string
  last_action: string
  player_assisted: string | null
  body_part: string | null
  goal_mouth_y: number | null
  goal_mouth_z: number | null
}

export type RatingCategory = 'finishing' | 'involvement' | 'carrying' | 'physical' | 'pressing'

export const RATING_CATEGORIES: RatingCategory[] = [
  'finishing',
  'involvement',
  'carrying',
  'physical',
  'pressing',
]

export const CATEGORY_LABELS: Record<RatingCategory, string> = {
  finishing: 'Finishing',
  involvement: 'Involvement',
  carrying: 'Carrying',
  physical: 'Physical',
  pressing: 'Defensive Effort',
}

export interface MatchGKStats {
  id: number
  match_id: number
  player_id: number
  team_id: number
  minutes_played: number
  saves: number
  punches: number
  goals_prevented: number
  good_high_claim: number
  saves_inside_box: number
  diving_save: number
  goals_conceded: number
  touches: number
  passes_total: number
  passes_completed: number
  total_long_balls: number
  accurate_long_balls: number
  aerial_duels_won: number
  aerial_duels_lost: number
  clearances: number
  ball_recovery: number
  error_lead_to_goal: number
  error_lead_to_shot: number
  penalty_conceded: number
  sofascore_rating: number | null
}

export interface MatchTeamStats {
  id: number
  match_id: number
  team_id: number
  possession_pct: number
  total_shots: number
  shots_on_target: number
  corners: number
  fouls: number
  offsides_team: number
  expected_goals: number
  big_chances: number
  big_chances_missed: number
  accurate_passes: number
  total_passes: number
  tackles: number
  interceptions: number
  saves_team: number
}

export interface LeagueStanding {
  id: number
  league_id: number
  season: string
  team_id: number
  position: number
  points: number
  played: number
  won: number
  drawn: number
  lost: number
  goals_for: number
  goals_against: number
  goal_difference: number
  form: string | null
  fetched_at: string
}

export interface MatchOdds {
  id: number
  match_id: number
  home_win: number | null
  draw: number | null
  away_win: number | null
}
