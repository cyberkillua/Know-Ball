import { createServerFn } from '@tanstack/react-start'
import { query, queryOne } from './db.server'
import type { League, Match, MatchRating, Player, PeerRating, PlayerPeerRatingResponse, PlayerUnderstat, Shot } from './types'

export const getLeagues = createServerFn({ method: 'GET' }).handler(async () => {
  return query<League>('SELECT * FROM leagues ORDER BY tier, name')
})

export const getLeaguePlayerCounts = createServerFn({ method: 'GET' }).handler(async () => {
  return query<{ league_id: number; player_count: number }>(
    `SELECT l.id as league_id, COUNT(DISTINCT p.id)::int as player_count
     FROM leagues l
     JOIN teams t ON t.league_id = l.id
     JOIN players p ON p.current_team_id = t.id
     GROUP BY l.id
     ORDER BY l.id`
  )
})

export const getTotalPlayerCount = createServerFn({ method: 'GET' }).handler(async () => {
  const row = await queryOne<{ count: number }>(
    'SELECT COUNT(*)::int as count FROM players'
  )
  return row?.count ?? 0
})

export const getLatestMatchday = createServerFn({ method: 'GET' })
  .inputValidator((d: { leagueId: number; season: string }) => d)
  .handler(async ({ data }) => {
    const row = await queryOne<{ matchday: number }>(
      `SELECT matchday FROM matches
       WHERE league_id = $1 AND season = $2 AND home_score IS NOT NULL
       ORDER BY matchday DESC LIMIT 1`,
      [data.leagueId, data.season],
    )
    return row?.matchday ?? null
  })

export const getMatchesByMatchday = createServerFn({ method: 'GET' })
  .inputValidator((d: { leagueId: number; season: string; matchday: number }) => d)
  .handler(async ({ data }) => {
    return query<Match>(
      `SELECT m.*,
              json_build_object('id', ht.id, 'name', ht.name, 'logo_url', ht.logo_url) as home_team,
              json_build_object('id', at.id, 'name', at.name, 'logo_url', at.logo_url) as away_team
       FROM matches m
       JOIN teams ht ON ht.id = m.home_team_id
       JOIN teams at ON at.id = m.away_team_id
       WHERE m.league_id = $1 AND m.season = $2 AND m.matchday = $3
       ORDER BY m.date`,
      [data.leagueId, data.season, data.matchday],
    )
  })

export const getTopRatedByMatchday = createServerFn({ method: 'GET' })
  .inputValidator((d: { leagueId: number; season: string; matchday: number }) => d)
  .handler(async ({ data }) => {
    return query(
      `SELECT mr.*,
              json_build_object('id', p.id, 'name', p.name, 'position', p.position) as player,
              json_build_object('id', mat.id, 'home_score', mat.home_score, 'away_score', mat.away_score,
                'home_team', json_build_object('name', ht.name),
                'away_team', json_build_object('name', at.name)) as match
       FROM match_ratings mr
       JOIN matches mat ON mat.id = mr.match_id
       JOIN players p ON p.id = mr.player_id
       JOIN teams ht ON ht.id = mat.home_team_id
       JOIN teams at ON at.id = mat.away_team_id
       WHERE mat.league_id = $1 AND mat.season = $2 AND mat.matchday = $3 AND mr.position = 'ST'
       ORDER BY mr.final_rating DESC`,
      [data.leagueId, data.season, data.matchday],
    )
  })

export const getMatch = createServerFn({ method: 'GET' })
  .inputValidator((d: { matchId: number }) => d)
  .handler(async ({ data }) => {
    return queryOne<Match>(
      `SELECT m.*,
              json_build_object('id', ht.id, 'name', ht.name) as home_team,
              json_build_object('id', at.id, 'name', at.name) as away_team
       FROM matches m
       JOIN teams ht ON ht.id = m.home_team_id
       JOIN teams at ON at.id = m.away_team_id
       WHERE m.id = $1`,
      [data.matchId],
    )
  })

export const getMatchRatings = createServerFn({ method: 'GET' })
  .inputValidator((d: { matchId: number }) => d)
  .handler(async ({ data }) => {
    return query<MatchRating>(
      `SELECT mr.*,
              json_build_object('id', p.id, 'name', p.name, 'position', p.position) as player
       FROM match_ratings mr
       JOIN players p ON p.id = mr.player_id
       WHERE mr.match_id = $1
       ORDER BY mr.final_rating DESC`,
      [data.matchId],
    )
  })

export const getPlayer = createServerFn({ method: 'GET' })
  .inputValidator((d: { playerId: number }) => d)
  .handler(async ({ data }) => {
    return queryOne<Player>(
      `SELECT p.*,
              json_build_object('id', t.id, 'name', t.name, 'league', json_build_object('id', l.id, 'name', l.name)) as team
       FROM players p
       LEFT JOIN teams t ON t.id = p.current_team_id
       LEFT JOIN leagues l ON l.id = t.league_id
       WHERE p.id = $1`,
      [data.playerId],
    )
  })

export const getPlayerSeasons = createServerFn({ method: 'GET' })
  .inputValidator((d: { playerId: number }) => d)
  .handler(async ({ data }) => {
    return query<{ season: string; league_id: number; league_name: string; matches: number }>(
      `SELECT DISTINCT
          mat.season,
          l.id as league_id,
          l.name as league_name,
          COUNT(DISTINCT mat.id)::int as matches
       FROM match_player_stats mps
       JOIN matches mat ON mat.id = mps.match_id
       JOIN leagues l ON l.id = mat.league_id
       WHERE mps.player_id = $1
       GROUP BY mat.season, l.id, l.name
       ORDER BY mat.season DESC, l.name`,
      [data.playerId],
    )
  })

export const getPlayerRatings = createServerFn({ method: 'GET' })
  .inputValidator((d: { playerId: number; season: string; leagueId: number }) => d)
  .handler(async ({ data }) => {
    return query<MatchRating>(
      `SELECT mr.*,
              json_build_object('id', mat.id, 'date', mat.date, 'matchday', mat.matchday,
                'home_score', mat.home_score, 'away_score', mat.away_score,
                'home_team', json_build_object('name', ht.name),
                'away_team', json_build_object('name', at.name)) as match
       FROM match_ratings mr
       JOIN matches mat ON mat.id = mr.match_id
       JOIN teams ht ON ht.id = mat.home_team_id
       JOIN teams at ON at.id = mat.away_team_id
       WHERE mr.player_id = $1 AND mat.season = $2 AND mat.league_id = $3
       ORDER BY mat.date ASC`,
      [data.playerId, data.season, data.leagueId],
    )
  })

export const getPlayerPeerRating = createServerFn({ method: 'GET' })
  .inputValidator((d: { playerId: number; season: string; leagueId: number; scope?: 'league' | 'all'; mode?: 'dominant' | 'position'; positionScope?: string }) => d)
  .handler(async ({ data }) => {
    const scope = data.scope ?? 'league'
    const peerRating = scope === 'all'
      ? await queryOne<PeerRating>(
          `SELECT * FROM peer_ratings
           WHERE player_id = $1 AND season = $2 AND league_id IS NULL
             AND peer_mode = 'dominant' AND position_scope = ''`,
          [data.playerId, data.season],
        )
      : await queryOne<PeerRating>(
          `SELECT * FROM peer_ratings
           WHERE player_id = $1 AND season = $2 AND league_id = $3
             AND peer_mode = 'dominant'
             AND position_scope = ''`,
          [data.playerId, data.season, data.leagueId],
        )

    return { peerRating, positionBreakdown: [], availablePositionScopes: [] } satisfies PlayerPeerRatingResponse
  })

export const getPlayerShots = createServerFn({ method: 'GET' })
  .inputValidator((d: { playerId: number; season: string; leagueId: number }) => d)
  .handler(async ({ data }) => {
    return query<Shot>(
      `SELECT s.*
       FROM shots s
       JOIN matches mat ON mat.id = s.match_id
       WHERE s.player_id = $1 AND mat.season = $2 AND mat.league_id = $3`,
      [data.playerId, data.season, data.leagueId],
    )
  })

export const getLeagueTopPlayers = createServerFn({ method: 'GET' })
  .inputValidator((d: { leagueId: number; season: string }) => d)
  .handler(async ({ data }) => {
    return query(
      `SELECT pr.*,
              json_build_object('id', p.id, 'name', p.name,
                'team', json_build_object('name', t.name)) as player
       FROM peer_ratings pr
       JOIN players p ON p.id = pr.player_id
       LEFT JOIN teams t ON t.id = p.current_team_id
       WHERE pr.league_id = $1 AND pr.season = $2
         AND pr.peer_mode = 'dominant' AND pr.position_scope = ''
       ORDER BY pr.avg_match_rating DESC
       LIMIT 50`,
      [data.leagueId, data.season],
    )
  })

export const getMatchdays = createServerFn({ method: 'GET' })
  .inputValidator((d: { leagueId: number; season: string }) => d)
  .handler(async ({ data }) => {
    const rows = await query<{ matchday: number }>(
      `SELECT DISTINCT matchday FROM matches
       WHERE league_id = $1 AND season = $2 AND home_score IS NOT NULL
       ORDER BY matchday`,
      [data.leagueId, data.season],
    )
    return rows.map((r) => r.matchday)
  })

export const getMatchdayStats = createServerFn({ method: 'GET' })
  .inputValidator((d: { leagueId: number; season: string; matchday: number }) => d)
  .handler(async ({ data }) => {
    return queryOne<{ players_rated: number; avg_rating: number; highest_rating: number }>(
      `SELECT COUNT(*)::int as players_rated,
              ROUND(AVG(mr.final_rating)::numeric, 2) as avg_rating,
              MAX(mr.final_rating) as highest_rating
       FROM match_ratings mr
       JOIN matches mat ON mat.id = mr.match_id
       WHERE mat.league_id = $1 AND mat.season = $2 AND mat.matchday = $3 AND mr.position = 'ST'`,
      [data.leagueId, data.season, data.matchday],
    )
  })

export const getMatchdayCategoryLeaders = createServerFn({ method: 'GET' })
  .inputValidator((d: { leagueId: number; season: string; matchday: number }) => d)
  .handler(async ({ data }) => {
    return query(
      `WITH ranked AS (
        SELECT mr.*,
               p.name as player_name, p.id as pid,
               ROW_NUMBER() OVER (ORDER BY mr.finishing_norm DESC) as fin_rank,
               ROW_NUMBER() OVER (ORDER BY mr.involvement_norm DESC) as inv_rank,
               ROW_NUMBER() OVER (ORDER BY mr.carrying_norm DESC) as car_rank,
               ROW_NUMBER() OVER (ORDER BY mr.physical_norm DESC) as phy_rank,
               ROW_NUMBER() OVER (ORDER BY mr.pressing_norm DESC) as prs_rank
        FROM match_ratings mr
        JOIN matches mat ON mat.id = mr.match_id
        JOIN players p ON p.id = mr.player_id
        WHERE mat.league_id = $1 AND mat.season = $2 AND mat.matchday = $3 AND mr.position = 'ST'
      )
      SELECT * FROM ranked
      WHERE fin_rank = 1 OR inv_rank = 1 OR car_rank = 1 OR phy_rank = 1 OR prs_rank = 1`,
      [data.leagueId, data.season, data.matchday],
    )
  })

export const getMatchStats = createServerFn({ method: 'GET' })
  .inputValidator((d: { matchId: number }) => d)
  .handler(async ({ data }) => {
    return query(
      `SELECT
         mps.team_id,
         t.name as team_name,
         COUNT(*)::int as players,
         SUM(mps.goals)::int as goals,
         SUM(mps.shots_total)::int as shots,
         SUM(mps.shots_on_target)::int as shots_on_target,
         ROUND(SUM(mps.xg)::numeric, 2) as xg,
         SUM(mps.touches)::int as touches,
         SUM(mps.passes_completed)::int as passes_completed,
         SUM(mps.passes_total)::int as passes_total,
         SUM(mps.successful_dribbles)::int as dribbles,
         SUM(mps.tackles_won)::int as tackles,
         SUM(mps.aerial_duels_won)::int as aerials_won,
         SUM(mps.ground_duels_won)::int as ground_duels_won,
         SUM(mps.interceptions)::int as interceptions
       FROM match_player_stats mps
       JOIN teams t ON t.id = mps.team_id
       WHERE mps.match_id = $1
       GROUP BY mps.team_id, t.name`,
      [data.matchId],
    )
  })

export const getLeagueStats = createServerFn({ method: 'GET' })
  .inputValidator((d: { leagueId: number; season: string }) => d)
  .handler(async ({ data }) => {
    return queryOne(
      `SELECT
         (SELECT COUNT(*) FROM matches WHERE league_id = $1 AND season = $2 AND home_score IS NOT NULL)::int as matches_played,
         (SELECT COUNT(*) FROM match_ratings mr JOIN matches mat ON mat.id = mr.match_id WHERE mat.league_id = $1 AND mat.season = $2 AND mr.position = 'ST')::int as players_rated,
         (SELECT ROUND(AVG(mr.final_rating)::numeric, 2) FROM match_ratings mr JOIN matches mat ON mat.id = mr.match_id WHERE mat.league_id = $1 AND mat.season = $2 AND mr.position = 'ST') as avg_rating,
         (SELECT MAX(mr.final_rating) FROM match_ratings mr JOIN matches mat ON mat.id = mr.match_id WHERE mat.league_id = $1 AND mat.season = $2 AND mr.position = 'ST') as highest_rating,
         (SELECT SUM(home_score + away_score)::int FROM matches WHERE league_id = $1 AND season = $2 AND home_score IS NOT NULL) as total_goals`,
      [data.leagueId, data.season],
    )
  })

export const getLeagueCategoryLeaders = createServerFn({ method: 'GET' })
  .inputValidator((d: { leagueId: number; season: string }) => d)
  .handler(async ({ data }) => {
    return query(
      `SELECT category, player_name, player_id, score FROM (
        SELECT 'finishing' as category, p.name as player_name, p.id as player_id,
               ROUND(AVG(mr.finishing_norm)::numeric, 2) as score,
               ROW_NUMBER() OVER (ORDER BY AVG(mr.finishing_norm) DESC) as rn
        FROM match_ratings mr JOIN matches mat ON mat.id = mr.match_id JOIN players p ON p.id = mr.player_id
        WHERE mat.league_id = $1 AND mat.season = $2 AND mr.position = 'ST' GROUP BY p.id, p.name
        UNION ALL
        SELECT 'involvement', p.name, p.id, ROUND(AVG(mr.involvement_norm)::numeric, 2),
               ROW_NUMBER() OVER (ORDER BY AVG(mr.involvement_norm) DESC)
        FROM match_ratings mr JOIN matches mat ON mat.id = mr.match_id JOIN players p ON p.id = mr.player_id
        WHERE mat.league_id = $1 AND mat.season = $2 AND mr.position = 'ST' GROUP BY p.id, p.name
        UNION ALL
        SELECT 'carrying', p.name, p.id, ROUND(AVG(mr.carrying_norm)::numeric, 2),
               ROW_NUMBER() OVER (ORDER BY AVG(mr.carrying_norm) DESC)
        FROM match_ratings mr JOIN matches mat ON mat.id = mr.match_id JOIN players p ON p.id = mr.player_id
        WHERE mat.league_id = $1 AND mat.season = $2 AND mr.position = 'ST' GROUP BY p.id, p.name
        UNION ALL
        SELECT 'physical', p.name, p.id, ROUND(AVG(mr.physical_norm)::numeric, 2),
               ROW_NUMBER() OVER (ORDER BY AVG(mr.physical_norm) DESC)
        FROM match_ratings mr JOIN matches mat ON mat.id = mr.match_id JOIN players p ON p.id = mr.player_id
        WHERE mat.league_id = $1 AND mat.season = $2 AND mr.position = 'ST' GROUP BY p.id, p.name
        UNION ALL
        SELECT 'pressing', p.name, p.id, ROUND(AVG(mr.pressing_norm)::numeric, 2),
               ROW_NUMBER() OVER (ORDER BY AVG(mr.pressing_norm) DESC)
        FROM match_ratings mr JOIN matches mat ON mat.id = mr.match_id JOIN players p ON p.id = mr.player_id
        WHERE mat.league_id = $1 AND mat.season = $2 AND mr.position = 'ST' GROUP BY p.id, p.name
      ) sub WHERE rn = 1`,
      [data.leagueId, data.season],
    )
  })

export const getPlayerStats = createServerFn({ method: 'GET' })
  .inputValidator((d: { playerId: number; season: string; leagueId: number }) => d)
  .handler(async ({ data }) => {
    return queryOne(
      `WITH player_team AS (
        SELECT p.id, p.current_team_id
        FROM players p
        WHERE p.id = $1
      ),
      team_matches AS (
        SELECT COUNT(*)::int as match_count, COUNT(*)::int * 90 as minutes_available
        FROM matches m
        WHERE m.season = $2
          AND m.league_id = $3
          AND m.home_score IS NOT NULL
          AND (m.home_team_id = (SELECT current_team_id FROM player_team)
               OR m.away_team_id = (SELECT current_team_id FROM player_team))
      )
      SELECT
          COUNT(*)::int as matches,
          COUNT(CASE WHEN mps.minutes_played >= 45 THEN 1 END)::int as starts,
          COUNT(CASE WHEN mps.minutes_played < 45 THEN 1 END)::int as sub_appearances,
          SUM(mps.minutes_played)::int as minutes,

          -- Team stats
          (SELECT match_count FROM team_matches) as team_matches,
          (SELECT minutes_available FROM team_matches) as team_minutes_available,

          -- Attacking
          SUM(mps.goals)::int as goals,
          ROUND(SUM(mps.xg)::numeric, 2) as xg,
          ROUND(SUM(mps.xgot)::numeric, 2) as xgot,
          SUM(mps.shots_total)::int as shots,
          SUM(mps.shots_on_target)::int as shots_on_target,
          SUM(mps.shots_off_target)::int as shots_off_target,
          SUM(mps.big_chance_missed)::int as big_chances_missed,
          SUM(mps.hit_woodwork)::int as hit_woodwork,
          SUM(mps.blocked_scoring_attempt)::int as blocked_shots,
          SUM(mps.offsides)::int as offsides,
          SUM(mps.penalty_won)::int as penalties_won,

          -- Creativity
          SUM(mps.assists)::int as assists,
          ROUND(SUM(mps.xa)::numeric, 2) as xa,
          SUM(mps.key_passes)::int as key_passes,
          SUM(mps.big_chance_created)::int as big_chances_created,
          SUM(mps.total_cross)::int as total_cross,
          SUM(mps.accurate_cross)::int as accurate_cross,
          SUM(mps.total_long_balls)::int as total_long_balls,
          SUM(mps.accurate_long_balls)::int as accurate_long_balls,
          SUM(mps.passes_completed)::int as passes_completed,
          SUM(mps.passes_total)::int as passes_total,
          SUM(mps.touches)::int as touches,

          -- Carrying
          SUM(mps.successful_dribbles)::int as dribbles,
          SUM(mps.failed_dribbles)::int as dribbles_failed,
          SUM(mps.fouls_won)::int as fouls_won,
          SUM(mps.possession_lost_ctrl)::int as possession_lost,

          -- Defense
          SUM(mps.tackles_won)::int as tackles,
          SUM(mps.interceptions)::int as interceptions,
          SUM(mps.aerial_duels_won)::int as aerials_won,
          SUM(mps.aerial_duels_lost)::int as aerials_lost,
          SUM(mps.ground_duels_won)::int as ground_duels_won,
          SUM(mps.ground_duels_lost)::int as ground_duels_lost,
          SUM(mps.clearances)::int as clearances,
          SUM(mps.ball_recovery)::int as ball_recoveries,
          SUM(mps.outfielder_block)::int as blocks,
          SUM(mps.error_lead_to_goal)::int as errors_led_to_goal,
          SUM(mps.error_lead_to_shot)::int as errors_led_to_shot,

          -- Discipline
          SUM(mps.yellow_cards)::int as yellow_cards,
          SUM(mps.red_cards)::int as red_cards,
          SUM(mps.fouls_committed)::int as fouls_committed,

          -- Per 90
          ROUND(SUM(mps.goals)::numeric        / NULLIF(SUM(mps.minutes_played), 0) * 90, 2) as goals_per90,
          ROUND(SUM(mps.xg)::numeric           / NULLIF(SUM(mps.minutes_played), 0) * 90, 2) as xg_per90,
          ROUND(SUM(mps.shots_total)::numeric  / NULLIF(SUM(mps.minutes_played), 0) * 90, 2) as shots_per90,
          ROUND(SUM(mps.shots_on_target)::numeric / NULLIF(SUM(mps.minutes_played), 0) * 90, 2) as shots_on_target_per90,
          ROUND(SUM(mps.big_chance_missed)::numeric / NULLIF(SUM(mps.minutes_played), 0) * 90, 2) as big_chances_missed_per90,
          ROUND(SUM(mps.assists)::numeric      / NULLIF(SUM(mps.minutes_played), 0) * 90, 2) as assists_per90,
          ROUND(SUM(mps.xa)::numeric           / NULLIF(SUM(mps.minutes_played), 0) * 90, 2) as xa_per90,
          ROUND(SUM(mps.key_passes)::numeric   / NULLIF(SUM(mps.minutes_played), 0) * 90, 2) as key_passes_per90,
          ROUND(SUM(mps.big_chance_created)::numeric / NULLIF(SUM(mps.minutes_played), 0) * 90, 2) as big_chances_created_per90,
          ROUND(SUM(mps.successful_dribbles)::numeric / NULLIF(SUM(mps.minutes_played), 0) * 90, 2) as dribbles_per90,
          ROUND(SUM(mps.touches)::numeric      / NULLIF(SUM(mps.minutes_played), 0) * 90, 2) as touches_per90,
          ROUND(SUM(mps.tackles_won)::numeric  / NULLIF(SUM(mps.minutes_played), 0) * 90, 2) as tackles_per90,
          ROUND(SUM(mps.interceptions)::numeric / NULLIF(SUM(mps.minutes_played), 0) * 90, 2) as interceptions_per90,
          ROUND(SUM(mps.aerial_duels_won)::numeric / NULLIF(SUM(mps.minutes_played), 0) * 90, 2) as aerials_per90,
          ROUND(SUM(mps.clearances)::numeric   / NULLIF(SUM(mps.minutes_played), 0) * 90, 2) as clearances_per90,
          ROUND(SUM(mps.ball_recovery)::numeric / NULLIF(SUM(mps.minutes_played), 0) * 90, 2) as ball_recoveries_per90,
          ROUND(SUM(mps.fouls_won)::numeric    / NULLIF(SUM(mps.minutes_played), 0) * 90, 2) as fouls_won_per90,
          ROUND(SUM(mps.possession_lost_ctrl)::numeric / NULLIF(SUM(mps.minutes_played), 0) * 90, 2) as possession_lost_per90,

          -- Derived stats (computed at query time)
          ROUND(SUM(mps.xg)::numeric / NULLIF(SUM(mps.shots_total), 0), 3)                   AS xg_per_shot,
          ROUND(SUM(mps.shots_on_target)::numeric / NULLIF(SUM(mps.shots_total), 0), 2)       AS shot_on_target_rate,
          ROUND((SUM(mps.goals) - SUM(mps.xg))::numeric, 2)                                  AS xg_overperformance,
          ROUND((SUM(mps.xg) + SUM(mps.xa))::numeric / NULLIF(SUM(mps.minutes_played) / 90.0, 0), 2) AS xg_plus_xa_per90,
          ROUND((SUM(mps.xg) + SUM(mps.xa))::numeric, 2) AS xg_plus_xa,
          ROUND(SUM(mps.successful_dribbles)::numeric /
                NULLIF(SUM(mps.successful_dribbles) + SUM(mps.failed_dribbles), 0), 2)        AS dribble_success_rate,
          ROUND(SUM(mps.goals)::numeric / NULLIF(SUM(mps.shots_total), 0), 2)                 AS shot_conversion_rate,
          ROUND(SUM(mps.aerial_duels_won)::numeric /
                NULLIF(SUM(mps.aerial_duels_won) + SUM(mps.aerial_duels_lost), 0), 2)         AS aerial_win_rate,
          ROUND(SUM(mps.ground_duels_won)::numeric /
                NULLIF(SUM(mps.ground_duels_won) + SUM(mps.ground_duels_lost), 0), 2)         AS ground_duel_win_rate,
          ROUND(SUM(mps.possession_lost_ctrl)::numeric / NULLIF(SUM(mps.touches), 0), 3)      AS possession_loss_rate,
          ROUND(SUM(mps.xgot)::numeric / NULLIF(SUM(mps.minutes_played) / 90.0, 0), 2)        AS xgot_per90,
          ROUND(SUM(mps.ball_recovery)::numeric / NULLIF(SUM(mps.minutes_played) / 90.0, 0), 2) AS ball_recovery_per90,
          ROUND(SUM(mps.big_chance_created)::numeric / NULLIF(SUM(mps.minutes_played) / 90.0, 0), 2) AS big_chance_created_per90,
          ROUND(SUM(mps.accurate_cross)::numeric / NULLIF(SUM(mps.minutes_played) / 90.0, 0), 2) AS accurate_cross_per90,
          ROUND(SUM(mps.ground_duels_won)::numeric / NULLIF(SUM(mps.minutes_played) / 90.0, 0), 2) AS ground_duels_won_per90,
          ROUND(SUM(mps.total_contest)::numeric / NULLIF(SUM(mps.minutes_played) / 90.0, 0), 2) AS total_contest_per90,
          SUM(mps.total_contest)::int AS total_contests,
          ROUND(SUM(mps.fouls_committed)::numeric / NULLIF(SUM(mps.minutes_played) / 90.0, 0), 2) AS fouls_committed_per90,
          (SUM(mps.goals) - SUM(mps.penalty_goals))::int AS np_goals,
          ROUND(SUM(mps.np_xg)::numeric, 2) AS np_xg_total,
          ROUND((SUM(mps.goals) - SUM(mps.penalty_goals))::numeric / NULLIF(SUM(mps.minutes_played), 0) * 90, 2) AS np_goals_per90,
          ROUND(SUM(mps.np_xg)::numeric / NULLIF(SUM(mps.minutes_played), 0) * 90, 2) AS np_xg_per90,
          ROUND(SUM(mps.np_xg)::numeric / NULLIF(SUM(mps.np_shots), 0), 3) AS np_xg_per_shot
        FROM match_player_stats mps
        JOIN matches mat ON mat.id = mps.match_id
        WHERE mps.player_id = $1 AND mat.season = $2 AND mat.league_id = $3`,
      [data.playerId, data.season, data.leagueId],
    )
  })

export const getPlayerXgotDelta = createServerFn({ method: 'GET' })
  .inputValidator((d: { playerId: number; season: string; leagueId: number }) => d)
  .handler(async ({ data }) => {
    return queryOne<{ delta: number | null }>(
      `SELECT ROUND((SUM(mps.xgot) - SUM(mps.xg))::numeric, 2) as delta
       FROM match_player_stats mps
       JOIN matches mat ON mat.id = mps.match_id
       WHERE mps.player_id = $1 AND mat.season = $2 AND mat.league_id = $3`,
      [data.playerId, data.season, data.leagueId],
    )
  })

export const getPlayerMatchStats = createServerFn({ method: 'GET' })
  .inputValidator((d: { playerId: number; matchId: number }) => d)
  .handler(async ({ data }) => {
    return queryOne(
      `SELECT mps.*
       FROM match_player_stats mps
       WHERE mps.player_id = $1 AND mps.match_id = $2`,
      [data.playerId, data.matchId],
    )
  })

export const searchPlayers = createServerFn({ method: 'GET' })
  .inputValidator((d: { query: string }) => d)
  .handler(async ({ data }) => {
    return query<Player>(
      `SELECT p.*,
              json_build_object('id', t.id, 'name', t.name, 'league_id', t.league_id) as team
       FROM players p
       LEFT JOIN teams t ON t.id = p.current_team_id
       WHERE p.name ILIKE $1
       LIMIT 10`,
      [`%${data.query}%`],
    )
  })

export const getPlayerUnderstat = createServerFn({ method: 'GET' })
  .inputValidator((d: { playerId: number; season: string }) => d)
  .handler(async ({ data }) => {
    return queryOne<PlayerUnderstat>(
      `SELECT xg_chain, xg_buildup, xg_chain_per90, xg_buildup_per90, minutes_played
       FROM player_season_understat
       WHERE player_id = $1 AND season = $2`,
      [data.playerId, data.season],
    )
  })

export interface LeaguePlayer {
  id: number
  name: string
  position: string | null
  nationality: string | null
  date_of_birth: string | null
  age: number | null
  club: string | null
  club_id: number | null
  photo_url: string | null
  model_score: number | null
}

export const getLeaguePlayers = createServerFn({ method: 'GET' })
  .inputValidator((d: { leagueId: number; season: string; search?: string; position?: string; clubId?: number }) => d)
  .handler(async ({ data }) => {
    const params: any[] = [data.leagueId, data.season]
    let posFilter = ''
    let clubFilter = ''
    let searchFilter = ''

    if (data.position && data.position !== 'All') {
      posFilter = ` AND p.position = $${params.length + 1}`
      params.push(data.position)
    }
    if (data.clubId) {
      clubFilter = ` AND season_team.team_id = $${params.length + 1}`
      params.push(data.clubId)
    }
    if (data.search) {
      searchFilter = ` AND p.name ILIKE $${params.length + 1}`
      params.push(`%${data.search}%`)
    }

    return query<LeaguePlayer>(
      `SELECT p.id, p.name, p.position, p.nationality, p.date_of_birth,
              EXTRACT(YEAR FROM AGE(p.date_of_birth))::int as age,
              st.name as club, season_team.team_id as club_id, p.photo_url,
              pr.model_score
       FROM players p
       JOIN LATERAL (
         SELECT mps.team_id, COUNT(*) as cnt
         FROM match_player_stats mps
         JOIN matches m ON m.id = mps.match_id
         WHERE mps.player_id = p.id AND m.league_id = $1 AND m.season = $2
         GROUP BY mps.team_id
         ORDER BY cnt DESC LIMIT 1
       ) season_team ON true
       LEFT JOIN teams st ON st.id = season_team.team_id
       LEFT JOIN peer_ratings pr ON pr.player_id = p.id AND pr.league_id = $1 AND pr.season = $2
         AND pr.peer_mode = 'dominant' AND pr.position_scope = ''
       WHERE EXISTS (
         SELECT 1 FROM match_player_stats mps
         JOIN matches m ON m.id = mps.match_id
         WHERE mps.player_id = p.id AND m.league_id = $1 AND m.season = $2
       )
         ${posFilter}${clubFilter}${searchFilter}
       ORDER BY pr.model_score DESC NULLS LAST, p.name ASC`,
      params,
    )
  })

export const getLeagueSeasons = createServerFn({ method: 'GET' })
  .inputValidator((d: { leagueId: number }) => d)
  .handler(async ({ data }) => {
    return query<{ season: string }>(
      `SELECT DISTINCT season FROM matches
       WHERE league_id = $1 AND home_score IS NOT NULL
       ORDER BY season DESC`,
      [data.leagueId],
    )
  })

export const getLeagueTeams = createServerFn({ method: 'GET' })
  .inputValidator((d: { leagueId: number }) => d)
  .handler(async ({ data }) => {
    return query<{ id: number; name: string }>(
      `SELECT id, name FROM teams
       WHERE league_id = $1
       ORDER BY name`,
      [data.leagueId],
    )
  })

export const getLeaguePositions = createServerFn({ method: 'GET' })
  .inputValidator((d: { leagueId: number; season: string }) => d)
  .handler(async ({ data }) => {
    const rows = await query<{ position: string }>(
      `SELECT DISTINCT p.position
       FROM players p
       JOIN teams t ON t.id = p.current_team_id
       JOIN match_player_stats mps ON mps.player_id = p.id
       JOIN matches m ON m.id = mps.match_id
       WHERE t.league_id = $1 AND m.season = $2 AND p.position IS NOT NULL
       ORDER BY p.position`,
      [data.leagueId, data.season],
    )
    return rows.map((r) => r.position)
  })
