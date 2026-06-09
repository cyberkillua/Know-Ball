import { createServerFn } from '@tanstack/react-start'
import { query, queryOne } from './db.server'
import { POSITION_GROUPS, POSITION_GROUP_TO_RATING_CODES, ratingCodeToPositionGroup, type PositionGroup } from './positions'
import type { League, Match, MatchRating, PeerMetricRank, Player, PlayerSeasonTrendPoint, PlayerStats, PeerRating, PlayerPeerRatingResponse, PlayerUnderstat, RoleFitProfile, Shot, SimilarRoleProfile } from './types'

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

export const getTopRatedFromLatestMatchdays = createServerFn({ method: 'GET' })
  .inputValidator((d: { season: string; limit?: number }) => d)
  .handler(async ({ data }) => {
    return query(
      `WITH latest_matchdays AS (
         SELECT league_id, MAX(matchday) as matchday
         FROM matches
         WHERE season = $1
           AND home_score IS NOT NULL
           AND matchday IS NOT NULL
         GROUP BY league_id
       )
       SELECT mr.*,
              json_build_object('id', p.id, 'name', p.name, 'position', p.position) as player,
              json_build_object('id', l.id, 'name', l.name) as league,
              json_build_object('id', mat.id, 'home_score', mat.home_score, 'away_score', mat.away_score,
                'home_team', json_build_object('name', ht.name),
                'away_team', json_build_object('name', at.name)) as match
       FROM latest_matchdays lm
       JOIN matches mat ON mat.league_id = lm.league_id AND mat.matchday = lm.matchday AND mat.season = $1
       JOIN leagues l ON l.id = mat.league_id
       JOIN match_ratings mr ON mr.match_id = mat.id
       JOIN players p ON p.id = mr.player_id
       JOIN teams ht ON ht.id = mat.home_team_id
       JOIN teams at ON at.id = mat.away_team_id
       ORDER BY mr.final_rating DESC
       LIMIT $2`,
      [data.season, data.limit ?? 10],
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

type PlayerSeasonRow = { season: string; league_id: number; league_name: string; matches: number }

function playerQuery(playerId: number) {
  return queryOne<Player>(
    `SELECT p.*,
            json_build_object('id', t.id, 'name', t.name, 'league', json_build_object('id', l.id, 'name', l.name)) as team
     FROM players p
     LEFT JOIN teams t ON t.id = p.current_team_id
     LEFT JOIN leagues l ON l.id = t.league_id
     WHERE p.id = $1`,
    [playerId],
  )
}

function playerSeasonsQuery(playerId: number) {
  return query<PlayerSeasonRow>(
    `SELECT pr.season,
            l.id as league_id,
            l.name as league_name,
            pr.matches_played::int as matches
     FROM peer_ratings pr
     JOIN leagues l ON l.id = pr.league_id
     WHERE pr.player_id = $1
       AND pr.league_id IS NOT NULL
       AND pr.peer_mode = 'dominant'
       AND pr.position_scope = ''
     ORDER BY pr.season DESC, l.name`,
    [playerId],
  )
}

export const getPlayer = createServerFn({ method: 'GET' })
  .inputValidator((d: { playerId: number }) => d)
  .handler(async ({ data }) => playerQuery(data.playerId))

export const getPlayerSeasons = createServerFn({ method: 'GET' })
  .inputValidator((d: { playerId: number }) => d)
  .handler(async ({ data }) => playerSeasonsQuery(data.playerId))

type SeasonScopedInput = { playerId: number; season: string; leagueId: number }

function playerRatingsQuery(data: SeasonScopedInput) {
  return query<MatchRating>(
    `SELECT mr.*,
            mps.team_id as player_team_id,
            json_build_object('id', mat.id, 'date', mat.date, 'matchday', mat.matchday,
              'home_team_id', mat.home_team_id, 'away_team_id', mat.away_team_id,
              'home_score', mat.home_score, 'away_score', mat.away_score,
              'home_team', json_build_object('id', ht.id, 'name', ht.name),
              'away_team', json_build_object('id', at.id, 'name', at.name)) as match
     FROM match_ratings mr
     JOIN matches mat ON mat.id = mr.match_id
     JOIN teams ht ON ht.id = mat.home_team_id
     JOIN teams at ON at.id = mat.away_team_id
     LEFT JOIN match_player_stats mps ON mps.match_id = mr.match_id AND mps.player_id = mr.player_id
     WHERE mr.player_id = $1 AND mat.season = $2 AND mat.league_id = $3
     ORDER BY mat.date ASC`,
    [data.playerId, data.season, data.leagueId],
  )
}

export const getPlayerRatings = createServerFn({ method: 'GET' })
  .inputValidator((d: SeasonScopedInput) => d)
  .handler(async ({ data }) => playerRatingsQuery(data))

function playerSeasonTrendQuery(playerId: number) {
  return query<PlayerSeasonTrendPoint>(
    `SELECT pr.season,
            pr.league_id,
            l.name as league_name,
            pr.position,
            pr.model_score,
            pr.model_score_confidence,
            pr.rated_minutes,
            pr.matches_played,
            pr.minutes_played,
            pr.avg_match_rating
     FROM peer_ratings pr
     LEFT JOIN leagues l ON l.id = pr.league_id
     WHERE pr.player_id = $1
       AND pr.league_id IS NOT NULL
       AND pr.peer_mode = 'dominant'
       AND pr.position_scope = ''
       AND pr.model_score IS NOT NULL
     ORDER BY pr.season ASC, l.name ASC`,
    [playerId],
  )
}

export const getPlayerSeasonTrend = createServerFn({ method: 'GET' })
  .inputValidator((d: { playerId: number }) => d)
  .handler(async ({ data }) => playerSeasonTrendQuery(data.playerId))

async function playerPeerRatingQuery(
  data: SeasonScopedInput & { scope?: 'league' | 'all' },
): Promise<PlayerPeerRatingResponse> {
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

  return { peerRating, positionBreakdown: [], availablePositionScopes: [] }
}

export const getPlayerPeerRating = createServerFn({ method: 'GET' })
  .inputValidator((d: { playerId: number; season: string; leagueId: number; scope?: 'league' | 'all'; mode?: 'dominant' | 'position'; positionScope?: string }) => d)
  .handler(async ({ data }) => playerPeerRatingQuery(data))

function roleVector(roleFit: RoleFitProfile | null | undefined) {
  const vector = new Map<string, number>()
  for (const fit of roleFit?.top ?? []) {
    vector.set(fit.key, Number(fit.score) || 0)
  }
  return vector
}

function roleDistance(a: RoleFitProfile | null | undefined, b: RoleFitProfile | null | undefined) {
  const av = roleVector(a)
  const bv = roleVector(b)
  const keys = new Set([...av.keys(), ...bv.keys()])
  if (keys.size === 0) return Number.POSITIVE_INFINITY

  let total = 0
  for (const key of keys) {
    total += Math.abs((av.get(key) ?? 0) - (bv.get(key) ?? 0))
  }
  return total / keys.size
}

export const getSimilarRoleProfiles = createServerFn({ method: 'GET' })
  .inputValidator((d: { playerId: number; season: string; leagueId: number; limit?: number }) => d)
  .handler(async ({ data }) => {
    const target = await queryOne<Pick<PeerRating, 'position' | 'role_fit' | 'model_score'>>(
      `SELECT position, role_fit, model_score
       FROM peer_ratings
       WHERE player_id = $1 AND season = $2 AND league_id = $3
         AND peer_mode = 'dominant' AND position_scope = ''`,
      [data.playerId, data.season, data.leagueId],
    )

    if (!target?.role_fit) return []

    const candidates = await query<Pick<PeerRating, 'player_id' | 'season' | 'position' | 'role_archetype' | 'role_fit' | 'role_confidence' | 'model_score'> & { player_name: string; league_name: string | null }>(
      `SELECT pr.player_id, pr.season, pr.position, pr.role_archetype, pr.role_fit,
              pr.role_confidence, pr.model_score,
              p.name as player_name, l.name as league_name
       FROM peer_ratings pr
       JOIN players p ON p.id = pr.player_id
       LEFT JOIN leagues l ON l.id = pr.league_id
       WHERE pr.position = $1
         AND pr.peer_mode = 'dominant'
         AND pr.position_scope = ''
         AND pr.role_fit IS NOT NULL
         AND NOT (pr.player_id = $2 AND pr.season = $3 AND pr.league_id = $4)
       ORDER BY pr.role_confidence DESC NULLS LAST, pr.model_score DESC NULLS LAST
       LIMIT 300`,
      [target.position, data.playerId, data.season, data.leagueId],
    )

    return candidates
      .map((candidate) => {
        const distance = roleDistance(target.role_fit, candidate.role_fit)
        const modelScoreGap =
          target.model_score != null && candidate.model_score != null
            ? Math.abs(Number(target.model_score) - Number(candidate.model_score)) / 5
            : 0
        const similarity = Math.max(0, Math.min(100, 100 - distance - modelScoreGap))
        return {
          player_id: candidate.player_id,
          player_name: candidate.player_name,
          season: candidate.season,
          league_name: candidate.league_name,
          position: candidate.position,
          role_archetype: candidate.role_archetype,
          role_label: candidate.role_fit?.primary?.label ?? null,
          role_score: Number(candidate.role_fit?.primary?.score ?? 0),
          role_confidence: candidate.role_confidence,
          model_score: candidate.model_score,
          similarity: Number(similarity.toFixed(1)),
        } satisfies SimilarRoleProfile
      })
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, data.limit ?? 5)
  })

const SCOUTING_RANK_METRICS = [
  'overall_percentile',
  'productive_dribbling_percentile',
  'chance_creation_percentile',
  'goal_contribution_percentile',
  'carrying_percentile',
  'shot_generation_percentile',
  'defensive_percentile',
  'presence_percentile',
  'pass_to_assist_per90_percentile',
  'goal_threat_percentile',
  'team_function_percentile',
  'volume_passing_percentile',
  'control_percentile',
  'duels_percentile',
  'finishing_percentile',
  'involvement_percentile',
  'physical_percentile',
  'pressing_percentile',
  'xg_overperformance_percentile',
] as const

export const getPlayerPeerMetricRanks = createServerFn({ method: 'GET' })
  .inputValidator((d: { playerId: number; season: string; leagueId: number; scope?: 'league' | 'all' }) => d)
  .handler(async ({ data }) => getPeerMetricRanks(data))

export const getPlayerPeerMetricRankScopes = createServerFn({ method: 'GET' })
  .inputValidator((d: { playerId: number; season: string; leagueId: number }) => d)
  .handler(async ({ data }) => {
    const [league, all] = await Promise.all([
      getPeerMetricRanks({ ...data, scope: 'league' }),
      getPeerMetricRanks({ ...data, scope: 'all' }),
    ])
    return { league, all }
  })

async function getPeerMetricRanks(data: {
  playerId: number
  season: string
  leagueId: number
  scope?: 'league' | 'all'
}) {
    const scope = data.scope ?? 'league'
    const targetWhere = scope === 'all'
      ? `player_id = $1 AND season = $2 AND league_id IS NULL
         AND peer_mode = 'dominant' AND position_scope = ''`
      : `player_id = $1 AND season = $2 AND league_id = $3
         AND peer_mode = 'dominant' AND position_scope = ''`
    const poolWhere = scope === 'all'
      ? `pool.season = $2 AND pool.league_id IS NULL
         AND pool.position = target.position
         AND pool.peer_mode = 'dominant' AND pool.position_scope = ''
         AND COALESCE(pool.rated_minutes, 0) >= 300`
      : `pool.season = $2 AND pool.league_id = $3
         AND pool.position = target.position
         AND pool.peer_mode = 'dominant' AND pool.position_scope = ''
         AND COALESCE(pool.rated_minutes, 0) >= 300`
    const params = scope === 'all'
      ? [data.playerId, data.season]
      : [data.playerId, data.season, data.leagueId]
    const metricValues = SCOUTING_RANK_METRICS.map((metric) => (
      `('${metric}'::text, pool.${metric}::float, target.${metric}::float)`
    )).join(',\n')

    const rows = await query<PeerMetricRank>(
      `WITH target AS (
        SELECT position, ${SCOUTING_RANK_METRICS.join(', ')}
        FROM peer_ratings
        WHERE ${targetWhere}
        LIMIT 1
      )
      SELECT
        metric_values.metric,
        (COUNT(*) FILTER (WHERE metric_values.pool_value > metric_values.target_value) + 1)::int AS rank,
        COUNT(metric_values.pool_value)::int AS "poolSize",
        MAX(metric_values.target_value)::float AS percentile
      FROM target
      JOIN peer_ratings pool ON ${poolWhere}
      CROSS JOIN LATERAL (
        VALUES
          ${metricValues}
      ) AS metric_values(metric, pool_value, target_value)
      WHERE metric_values.target_value IS NOT NULL
      GROUP BY metric_values.metric`,
      params,
    )

    return rows.reduce<Record<string, PeerMetricRank>>((acc, row) => {
      if (row.poolSize > 0) acc[row.metric] = row
      return acc
    }, {})
}

function playerShotsQuery(data: SeasonScopedInput) {
  return query<Shot>(
    `SELECT s.*
     FROM shots s
     JOIN matches mat ON mat.id = s.match_id
     WHERE s.player_id = $1 AND mat.season = $2 AND mat.league_id = $3`,
    [data.playerId, data.season, data.leagueId],
  )
}

export const getPlayerShots = createServerFn({ method: 'GET' })
  .inputValidator((d: SeasonScopedInput) => d)
  .handler(async ({ data }) => playerShotsQuery(data))

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

function playerStatsQuery(data: SeasonScopedInput) {
  return queryOne<PlayerStats>(
      `WITH player_team AS (
        SELECT mps.team_id, COUNT(*) as cnt
        FROM match_player_stats mps
        JOIN matches m ON m.id = mps.match_id
        WHERE mps.player_id = $1 AND m.season = $2 AND m.league_id = $3
        GROUP BY mps.team_id
        ORDER BY cnt DESC LIMIT 1
      ),
      team_matches AS (
        SELECT COUNT(*)::int as match_count, COUNT(*)::int * 90 as minutes_available
        FROM matches m
        WHERE m.season = $2
          AND m.league_id = $3
          AND m.home_score IS NOT NULL
          AND (m.home_team_id = (SELECT team_id FROM player_team)
               OR m.away_team_id = (SELECT team_id FROM player_team))
      )
      SELECT
          (SELECT t.name FROM teams t WHERE t.id = (SELECT team_id FROM player_team)) as team_name,
          (SELECT team_id FROM player_team) as team_id,
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
          ROUND(AVG(NULLIF(mps.pass_value_normalized, 0))::numeric, 3) as pass_value_normalized,
          MAX(pss.accurate_final_third_passes)::int as accurate_final_third_passes,
          MAX(pss.pass_to_assist)::int as pass_to_assist,

          -- Carrying
          SUM(mps.successful_dribbles)::int as dribbles,
          SUM(mps.failed_dribbles)::int as dribbles_failed,
          SUM(mps.fouls_won)::int as fouls_won,
          SUM(mps.possession_lost_ctrl)::int as possession_lost,
          ROUND(SUM(COALESCE(mps.total_progressive_ball_carries_distance, 0))::numeric, 2) as progressive_carries_distance,

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
          ROUND(SUM(COALESCE(mps.total_progressive_ball_carries_distance, 0))::numeric / NULLIF(SUM(mps.minutes_played) / 90.0, 0), 2) AS progressive_carries_distance_per90,
          ROUND(MAX(pss.accurate_final_third_passes)::numeric / NULLIF(SUM(mps.minutes_played) / 90.0, 0), 2) AS accurate_final_third_passes_per90,
          ROUND(MAX(pss.pass_to_assist)::numeric / NULLIF(SUM(mps.minutes_played) / 90.0, 0), 2) AS pass_to_assist_per90,
          (SUM(mps.goals) - SUM(mps.penalty_goals))::int AS np_goals,
          ROUND(SUM(mps.np_xg)::numeric, 2) AS np_xg_total,
          ROUND((SUM(mps.goals) - SUM(mps.penalty_goals))::numeric / NULLIF(SUM(mps.minutes_played), 0) * 90, 2) AS np_goals_per90,
          ROUND(SUM(mps.np_xg)::numeric / NULLIF(SUM(mps.minutes_played), 0) * 90, 2) AS np_xg_per90,
          ROUND(SUM(mps.np_xg)::numeric / NULLIF(SUM(mps.np_shots), 0), 3) AS np_xg_per_shot
        FROM match_player_stats mps
        JOIN matches mat ON mat.id = mps.match_id
        LEFT JOIN player_season_sofascore pss
          ON pss.player_id = mps.player_id
         AND pss.league_id = mat.league_id
         AND pss.season = mat.season
        WHERE mps.player_id = $1 AND mat.season = $2 AND mat.league_id = $3`,
      [data.playerId, data.season, data.leagueId],
  )
}

export const getPlayerStats = createServerFn({ method: 'GET' })
  .inputValidator((d: SeasonScopedInput) => d)
  .handler(async ({ data }) => playerStatsQuery(data))

function playerXgotDeltaQuery(data: SeasonScopedInput) {
  return queryOne<{ delta: number | null }>(
    `SELECT ROUND((SUM(mps.xgot) - SUM(mps.xg))::numeric, 2) as delta
     FROM match_player_stats mps
     JOIN matches mat ON mat.id = mps.match_id
     WHERE mps.player_id = $1 AND mat.season = $2 AND mat.league_id = $3`,
    [data.playerId, data.season, data.leagueId],
  )
}

export const getPlayerXgotDelta = createServerFn({ method: 'GET' })
  .inputValidator((d: SeasonScopedInput) => d)
  .handler(async ({ data }) => playerXgotDeltaQuery(data))

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
       WHERE unaccent(p.name) ILIKE '%' || unaccent($1) || '%'
          OR similarity(unaccent(lower(p.name)), unaccent(lower($1))) > 0.3
       ORDER BY similarity(unaccent(lower(p.name)), unaccent(lower($1))) DESC
       LIMIT 10`,
      [data.query],
    )
  })

function playerUnderstatQuery(playerId: number, season: string) {
  return queryOne<PlayerUnderstat>(
    `SELECT xg_chain, xg_buildup, xg_chain_per90, xg_buildup_per90, minutes_played
     FROM player_season_understat
     WHERE player_id = $1 AND season = $2`,
    [playerId, season],
  )
}

export const getPlayerUnderstat = createServerFn({ method: 'GET' })
  .inputValidator((d: { playerId: number; season: string }) => d)
  .handler(async ({ data }) => playerUnderstatQuery(data.playerId, data.season))

export const getPlayerOverview = createServerFn({ method: 'GET' })
  .inputValidator((d: { playerId: number }) => d)
  .handler(async ({ data }) => {
    const [player, seasons, trend] = await Promise.all([
      playerQuery(data.playerId),
      playerSeasonsQuery(data.playerId),
      playerSeasonTrendQuery(data.playerId),
    ])
    return { player, seasons, trend }
  })

export const getPlayerSeasonBundle = createServerFn({ method: 'GET' })
  .inputValidator((d: SeasonScopedInput) => d)
  .handler(async ({ data }) => {
    const [ratings, peerLeague, peerAll, stats, shots, understat, xgot] =
      await Promise.all([
        playerRatingsQuery(data),
        playerPeerRatingQuery({ ...data, scope: 'league' }),
        playerPeerRatingQuery({ ...data, scope: 'all' }),
        playerStatsQuery(data),
        playerShotsQuery(data),
        playerUnderstatQuery(data.playerId, data.season),
        playerXgotDeltaQuery(data),
      ])
    return {
      ratings,
      peerRatingLeague: peerLeague.peerRating,
      peerRatingAll: peerAll.peerRating,
      stats,
      shots,
      understat,
      xgotDelta: xgot?.delta != null ? Number(xgot.delta) : null,
    }
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
  model_score_confidence: number | null
  rated_minutes: number | null
}

export const getLeaguePlayers = createServerFn({ method: 'GET' })
  .inputValidator((d: { leagueId: number; season: string; search?: string; position?: PositionGroup; clubId?: number }) => d)
  .handler(async ({ data }) => {
    const params: any[] = [data.leagueId, data.season]
    let posFilter = ''
    let clubFilter = ''
    let searchFilter = ''

    if (data.position) {
      const codes = POSITION_GROUP_TO_RATING_CODES[data.position] ?? []
      if (codes.length > 0) {
        posFilter = ` AND pr.position = ANY($${params.length + 1})`
        params.push(codes)
      }
    }
    if (data.clubId) {
      clubFilter = ` AND pr.primary_team_id = $${params.length + 1}`
      params.push(data.clubId)
    }
    if (data.search) {
      const idx = params.length + 1
      searchFilter = ` AND (unaccent(p.name) ILIKE '%' || unaccent($${idx}) || '%' OR similarity(unaccent(lower(p.name)), unaccent(lower($${idx}))) > 0.3)`
      params.push(data.search)
    }

    return query<LeaguePlayer>(
      `SELECT p.id, p.name, p.position as position, p.nationality, p.date_of_birth,
              EXTRACT(YEAR FROM AGE(p.date_of_birth))::int as age,
              st.name as club, pr.primary_team_id as club_id, p.photo_url,
              pr.model_score, pr.model_score_confidence, pr.rated_minutes
       FROM peer_ratings pr
       JOIN players p ON p.id = pr.player_id
       LEFT JOIN teams st ON st.id = pr.primary_team_id
       WHERE pr.league_id = $1 AND pr.season = $2
         AND pr.peer_mode = 'dominant' AND pr.position_scope = ''
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

export const getAllSeasons = createServerFn({ method: 'GET' }).handler(async () => {
  return query<{ season: string }>(
    `SELECT DISTINCT season FROM matches WHERE home_score IS NOT NULL ORDER BY season DESC`
  )
})

export const getAllPlayers = createServerFn({ method: 'GET' })
  .inputValidator((d: { leagueId?: number; season: string; search?: string; position?: PositionGroup; clubId?: number }) => d)
  .handler(async ({ data }) => {
    const params: any[] = [data.season]
    let leagueParamIdx: number | null = null

    if (data.leagueId != null) {
      params.push(data.leagueId)
      leagueParamIdx = params.length
    }

    const postWhere: string[] = []
    if (data.position != null) {
      const codes = POSITION_GROUP_TO_RATING_CODES[data.position] ?? []
      if (codes.length > 0) {
        params.push(codes)
        postWhere.push(`pr.position = ANY($${params.length})`)
      }
    }
    if (data.clubId != null) {
      params.push(data.clubId)
      postWhere.push(`pr.primary_team_id = $${params.length}`)
    }
    if (data.search) {
      params.push(data.search)
      const idx = params.length
      postWhere.push(`(unaccent(p.name) ILIKE '%' || unaccent($${idx}) || '%' OR similarity(unaccent(lower(p.name)), unaccent(lower($${idx}))) > 0.3)`)
    }

    const prLeagueFilter = leagueParamIdx != null ? `AND pr.league_id = $${leagueParamIdx}` : ''

    return query<LeaguePlayer & { league_name: string | null }>(
      `SELECT p.id, p.name, p.position as position, p.nationality, p.date_of_birth,
              EXTRACT(YEAR FROM AGE(p.date_of_birth))::int as age,
              st.name as club, pr.primary_team_id as club_id, p.photo_url,
              pr.model_score, pr.model_score_confidence, pr.rated_minutes, l.name as league_name
       FROM peer_ratings pr
       JOIN players p ON p.id = pr.player_id
       LEFT JOIN teams st ON st.id = pr.primary_team_id
       LEFT JOIN leagues l ON l.id = pr.league_id
       WHERE pr.season = $1
         AND pr.league_id IS NOT NULL
         ${prLeagueFilter}
         AND pr.peer_mode = 'dominant' AND pr.position_scope = ''
         ${postWhere.length ? `AND ${postWhere.join(' AND ')}` : ''}
       ORDER BY pr.model_score DESC NULLS LAST, p.name ASC
       LIMIT 500`,
      params,
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
    const rows = await query<{ rating_code: string }>(
      `SELECT DISTINCT position as rating_code
       FROM peer_ratings
       WHERE league_id = $1
         AND season = $2
         AND peer_mode = 'dominant'
         AND position_scope = ''
         AND position IS NOT NULL`,
      [data.leagueId, data.season],
    )
    const available = new Set(
      rows.map((r) => ratingCodeToPositionGroup(r.rating_code)).filter((g): g is PositionGroup => g != null),
    )
    return POSITION_GROUPS.filter((group) => available.has(group.value))
  })
