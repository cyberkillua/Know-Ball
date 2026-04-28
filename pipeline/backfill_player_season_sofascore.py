"""
Backfill per-player per-league-per-season stats from Sofascore.

Discovers every (player, league, season) triple implied by existing
match_player_stats rows and fetches the corresponding season aggregate
from unique-tournament/{t}/season/{s}/statistics/overall.

Run once after applying migration 036_passing_data_expansion.sql:

    python -m pipeline.backfill_player_season_sofascore

Scoped runs:

    python -m pipeline.backfill_player_season_sofascore --league 47 --season 2025/2026

Safe to re-run — all upserts use ON CONFLICT DO UPDATE.
"""

import argparse
import asyncio
import os

import psycopg2.extras
from curl_cffi.requests import AsyncSession

from pipeline.db import DB
from pipeline.logger import get_logger
from pipeline.scrapers.sofascore import (
    _SEASON_STAT_FIELD_MAP,
    _api_get_async,
    _parse_season_id_overrides,
    TOURNAMENT_IDS,
    get_season_id_by_name,
)

log = get_logger("backfill_player_season_sofascore")

_UPSERT_SQL = """
INSERT INTO player_season_sofascore (
  player_id, league_id, season,
  appearances, matches_started, minutes_played, rating, total_rating,
  count_rating, totw_appearances,
  goals, expected_goals, penalty_goals, headed_goals, left_foot_goals,
  right_foot_goals, goals_from_inside_box, goals_from_outside_box,
  shots_total, shots_on_target, shots_off_target, shots_from_inside_box,
  shots_from_outside_box, blocked_shots, hit_woodwork, goal_conversion_pct,
  scoring_frequency,
  accurate_passes, total_passes, accurate_passes_pct, inaccurate_passes,
  accurate_opposition_half_passes, total_opposition_half_passes,
  accurate_own_half_passes, total_own_half_passes,
  accurate_final_third_passes, accurate_chipped_passes, total_chipped_passes,
  accurate_long_balls, total_long_balls, accurate_long_balls_pct,
  accurate_crosses, total_cross, accurate_crosses_pct,
  key_passes, pass_to_assist, total_attempt_assist,
  assists, expected_assists, goals_assists_sum,
  big_chances_created, big_chances_missed,
  successful_dribbles, successful_dribbles_pct, total_contest, dispossessed,
  possession_lost, possession_won_att_third, dribbled_past,
  aerial_duels_won, aerial_duels_won_pct, aerial_lost,
  ground_duels_won, ground_duels_won_pct,
  total_duels_won, total_duels_won_pct, duel_lost,
  tackles, tackles_won, tackles_won_pct,
  interceptions, clearances, outfielder_blocks, ball_recovery,
  error_lead_to_goal, error_lead_to_shot,
  fouls, was_fouled, offsides, yellow_cards, yellow_red_cards, red_cards,
  own_goals, penalty_won, penalty_conceded, touches,
  fetched_at
) VALUES (
  %(player_id)s, %(league_id)s, %(season)s,
  %(appearances)s, %(matches_started)s, %(minutes_played)s, %(rating)s, %(total_rating)s,
  %(count_rating)s, %(totw_appearances)s,
  %(goals)s, %(expected_goals)s, %(penalty_goals)s, %(headed_goals)s, %(left_foot_goals)s,
  %(right_foot_goals)s, %(goals_from_inside_box)s, %(goals_from_outside_box)s,
  %(shots_total)s, %(shots_on_target)s, %(shots_off_target)s, %(shots_from_inside_box)s,
  %(shots_from_outside_box)s, %(blocked_shots)s, %(hit_woodwork)s, %(goal_conversion_pct)s,
  %(scoring_frequency)s,
  %(accurate_passes)s, %(total_passes)s, %(accurate_passes_pct)s, %(inaccurate_passes)s,
  %(accurate_opposition_half_passes)s, %(total_opposition_half_passes)s,
  %(accurate_own_half_passes)s, %(total_own_half_passes)s,
  %(accurate_final_third_passes)s, %(accurate_chipped_passes)s, %(total_chipped_passes)s,
  %(accurate_long_balls)s, %(total_long_balls)s, %(accurate_long_balls_pct)s,
  %(accurate_crosses)s, %(total_cross)s, %(accurate_crosses_pct)s,
  %(key_passes)s, %(pass_to_assist)s, %(total_attempt_assist)s,
  %(assists)s, %(expected_assists)s, %(goals_assists_sum)s,
  %(big_chances_created)s, %(big_chances_missed)s,
  %(successful_dribbles)s, %(successful_dribbles_pct)s, %(total_contest)s, %(dispossessed)s,
  %(possession_lost)s, %(possession_won_att_third)s, %(dribbled_past)s,
  %(aerial_duels_won)s, %(aerial_duels_won_pct)s, %(aerial_lost)s,
  %(ground_duels_won)s, %(ground_duels_won_pct)s,
  %(total_duels_won)s, %(total_duels_won_pct)s, %(duel_lost)s,
  %(tackles)s, %(tackles_won)s, %(tackles_won_pct)s,
  %(interceptions)s, %(clearances)s, %(outfielder_blocks)s, %(ball_recovery)s,
  %(error_lead_to_goal)s, %(error_lead_to_shot)s,
  %(fouls)s, %(was_fouled)s, %(offsides)s, %(yellow_cards)s, %(yellow_red_cards)s, %(red_cards)s,
  %(own_goals)s, %(penalty_won)s, %(penalty_conceded)s, %(touches)s,
  NOW()
)
ON CONFLICT (player_id, league_id, season) DO UPDATE SET
  appearances = EXCLUDED.appearances,
  matches_started = EXCLUDED.matches_started,
  minutes_played = EXCLUDED.minutes_played,
  rating = EXCLUDED.rating,
  total_rating = EXCLUDED.total_rating,
  count_rating = EXCLUDED.count_rating,
  totw_appearances = EXCLUDED.totw_appearances,
  goals = EXCLUDED.goals,
  expected_goals = EXCLUDED.expected_goals,
  penalty_goals = EXCLUDED.penalty_goals,
  headed_goals = EXCLUDED.headed_goals,
  left_foot_goals = EXCLUDED.left_foot_goals,
  right_foot_goals = EXCLUDED.right_foot_goals,
  goals_from_inside_box = EXCLUDED.goals_from_inside_box,
  goals_from_outside_box = EXCLUDED.goals_from_outside_box,
  shots_total = EXCLUDED.shots_total,
  shots_on_target = EXCLUDED.shots_on_target,
  shots_off_target = EXCLUDED.shots_off_target,
  shots_from_inside_box = EXCLUDED.shots_from_inside_box,
  shots_from_outside_box = EXCLUDED.shots_from_outside_box,
  blocked_shots = EXCLUDED.blocked_shots,
  hit_woodwork = EXCLUDED.hit_woodwork,
  goal_conversion_pct = EXCLUDED.goal_conversion_pct,
  scoring_frequency = EXCLUDED.scoring_frequency,
  accurate_passes = EXCLUDED.accurate_passes,
  total_passes = EXCLUDED.total_passes,
  accurate_passes_pct = EXCLUDED.accurate_passes_pct,
  inaccurate_passes = EXCLUDED.inaccurate_passes,
  accurate_opposition_half_passes = EXCLUDED.accurate_opposition_half_passes,
  total_opposition_half_passes = EXCLUDED.total_opposition_half_passes,
  accurate_own_half_passes = EXCLUDED.accurate_own_half_passes,
  total_own_half_passes = EXCLUDED.total_own_half_passes,
  accurate_final_third_passes = EXCLUDED.accurate_final_third_passes,
  accurate_chipped_passes = EXCLUDED.accurate_chipped_passes,
  total_chipped_passes = EXCLUDED.total_chipped_passes,
  accurate_long_balls = EXCLUDED.accurate_long_balls,
  total_long_balls = EXCLUDED.total_long_balls,
  accurate_long_balls_pct = EXCLUDED.accurate_long_balls_pct,
  accurate_crosses = EXCLUDED.accurate_crosses,
  total_cross = EXCLUDED.total_cross,
  accurate_crosses_pct = EXCLUDED.accurate_crosses_pct,
  key_passes = EXCLUDED.key_passes,
  pass_to_assist = EXCLUDED.pass_to_assist,
  total_attempt_assist = EXCLUDED.total_attempt_assist,
  assists = EXCLUDED.assists,
  expected_assists = EXCLUDED.expected_assists,
  goals_assists_sum = EXCLUDED.goals_assists_sum,
  big_chances_created = EXCLUDED.big_chances_created,
  big_chances_missed = EXCLUDED.big_chances_missed,
  successful_dribbles = EXCLUDED.successful_dribbles,
  successful_dribbles_pct = EXCLUDED.successful_dribbles_pct,
  total_contest = EXCLUDED.total_contest,
  dispossessed = EXCLUDED.dispossessed,
  possession_lost = EXCLUDED.possession_lost,
  possession_won_att_third = EXCLUDED.possession_won_att_third,
  dribbled_past = EXCLUDED.dribbled_past,
  aerial_duels_won = EXCLUDED.aerial_duels_won,
  aerial_duels_won_pct = EXCLUDED.aerial_duels_won_pct,
  aerial_lost = EXCLUDED.aerial_lost,
  ground_duels_won = EXCLUDED.ground_duels_won,
  ground_duels_won_pct = EXCLUDED.ground_duels_won_pct,
  total_duels_won = EXCLUDED.total_duels_won,
  total_duels_won_pct = EXCLUDED.total_duels_won_pct,
  duel_lost = EXCLUDED.duel_lost,
  tackles = EXCLUDED.tackles,
  tackles_won = EXCLUDED.tackles_won,
  tackles_won_pct = EXCLUDED.tackles_won_pct,
  interceptions = EXCLUDED.interceptions,
  clearances = EXCLUDED.clearances,
  outfielder_blocks = EXCLUDED.outfielder_blocks,
  ball_recovery = EXCLUDED.ball_recovery,
  error_lead_to_goal = EXCLUDED.error_lead_to_goal,
  error_lead_to_shot = EXCLUDED.error_lead_to_shot,
  fouls = EXCLUDED.fouls,
  was_fouled = EXCLUDED.was_fouled,
  offsides = EXCLUDED.offsides,
  yellow_cards = EXCLUDED.yellow_cards,
  yellow_red_cards = EXCLUDED.yellow_red_cards,
  red_cards = EXCLUDED.red_cards,
  own_goals = EXCLUDED.own_goals,
  penalty_won = EXCLUDED.penalty_won,
  penalty_conceded = EXCLUDED.penalty_conceded,
  touches = EXCLUDED.touches,
  fetched_at = NOW()
"""


def _discover_targets(
    db: DB,
    fotmob_id: int | None,
    season: str | None,
    *,
    skip_populated: bool = True,
    stale_days: int = 7,
) -> list[dict]:
    """
    Return [{player_id, sofascore_player_id, league_id, fotmob_id, season}, ...].
    """
    where, params = ["l.fotmob_id IS NOT NULL", "p.sofascore_id IS NOT NULL"], []
    if fotmob_id is not None:
        where.append("l.fotmob_id = %s")
        params.append(fotmob_id)
    if season is not None:
        where.append("m.season = %s")
        params.append(season)

    having_params: list = []
    if skip_populated:
        stale_clause = ""
        if stale_days > 0:
            stale_clause = " OR MAX(pss.fetched_at) < NOW() - (%s * INTERVAL '1 day')"
            having_params.append(stale_days)
        having = (
            "MAX(pss.fetched_at) IS NULL "
            "OR MAX(pss.fetched_at) < MAX(m.date)::timestamp"
            f"{stale_clause}"
        )
    else:
        having = "TRUE"

    sql = f"""
        SELECT
          p.id              AS player_id,
          p.sofascore_id    AS sofascore_player_id,
          l.id              AS league_id,
          l.fotmob_id       AS fotmob_id,
          m.season          AS season,
          MAX(m.date)       AS latest_match_date,
          MAX(pss.fetched_at) AS existing_fetched_at
        FROM match_player_stats mps
        JOIN players p ON p.id = mps.player_id
        JOIN matches m ON m.id = mps.match_id
        JOIN leagues l ON l.id = m.league_id
        LEFT JOIN player_season_sofascore pss
          ON pss.player_id = p.id
         AND pss.league_id = l.id
         AND pss.season = m.season
        WHERE {' AND '.join(where)}
        GROUP BY p.id, p.sofascore_id, l.id, l.fotmob_id, m.season
        HAVING {having}
        ORDER BY MAX(m.date) DESC, p.id
    """
    return db.query(sql, (*params, *having_params))


async def _fetch_flat(
    session: AsyncSession,
    semaphore: asyncio.Semaphore,
    target: dict,
) -> tuple[dict, dict | None]:
    async with semaphore:
        try:
            data = await _api_get_async(
                f"player/{target['sofascore_player_id']}/"
                f"unique-tournament/{target['tournament_id']}/"
                f"season/{target['season_id']}/statistics/overall",
                session,
            )
        except Exception as e:
            log.debug(
                f"fetch failed player={target['sofascore_player_id']} "
                f"t={target['tournament_id']} s={target['season_id']}: {e}"
            )
            return target, None

        stats = data.get("statistics") if data else None
        if not stats:
            return target, None

        flat = {
            db_col: stats.get(api_key)
            for db_col, api_key in _SEASON_STAT_FIELD_MAP.items()
        }
        flat["player_id"] = target["player_id"]
        flat["league_id"] = target["league_id"]
        flat["season"] = target["season"]
        return target, flat


async def _fetch_batch(targets: list[dict], concurrency: int) -> list[tuple[dict, dict | None]]:
    semaphore = asyncio.Semaphore(concurrency)
    async with AsyncSession() as session:
        return await asyncio.gather(
            *[_fetch_flat(session, semaphore, target) for target in targets]
        )


def backfill(
    fotmob_id: int | None = None,
    season: str | None = None,
    *,
    concurrency: int = 8,
    batch_size: int = 200,
    limit: int | None = None,
    skip_populated: bool = True,
    stale_days: int = 7,
) -> None:
    db = DB()
    try:
        targets = _discover_targets(
            db,
            fotmob_id,
            season,
            skip_populated=skip_populated,
            stale_days=stale_days,
        )
        if limit:
            targets = targets[:limit]
        log.info(
            f"Found {len(targets)} (player, league, season) triples to backfill "
            f"(skip_populated={skip_populated}, stale_days={stale_days})"
        )

        # Resolve a sofascore season_id per (fotmob_id, season) once.
        season_cache: dict[tuple[int, str], int | None] = {}
        season_id_overrides = _parse_season_id_overrides(
            os.getenv("SOFASCORE_SEASON_IDS")
        )

        def _resolve_season(fm_id: int, season_name: str) -> int | None:
            key = (fm_id, season_name)
            if key in season_cache:
                return season_cache[key]
            t_id = TOURNAMENT_IDS.get(fm_id)
            if not t_id:
                season_cache[key] = None
                return None
            override = season_id_overrides.get((t_id, season_name))
            if override:
                log.info(
                    f"Using SOFASCORE_SEASON_IDS override: "
                    f"tournament={t_id} season={season_name} id={override}"
                )
                season_cache[key] = override
                return override
            try:
                sid = get_season_id_by_name(t_id, season_name)
            except Exception as e:
                log.warning(
                    f"Could not resolve Sofascore season id for "
                    f"fotmob_league={fm_id} tournament={t_id} season={season_name}: {e}"
                )
                sid = None
            season_cache[key] = sid
            return sid

        resolved_targets: list[dict] = []
        skipped = 0
        for t in targets:
            fm_id = t["fotmob_id"]
            s_name = t["season"]
            t_id = TOURNAMENT_IDS.get(fm_id)
            if not t_id:
                skipped += 1
                continue
            s_id = _resolve_season(fm_id, s_name)
            if not s_id:
                skipped += 1
                continue
            t["tournament_id"] = t_id
            t["season_id"] = s_id
            resolved_targets.append(t)

        log.info(
            f"Resolved {len(resolved_targets)} targets "
            f"(skipped={skipped}, concurrency={concurrency}, batch_size={batch_size})"
        )

        ok, missing = 0, 0
        for batch_start in range(0, len(resolved_targets), batch_size):
            batch = resolved_targets[batch_start : batch_start + batch_size]
            results = asyncio.run(_fetch_batch(batch, concurrency))
            rows = [flat for _target, flat in results if flat]
            missing += len(results) - len(rows)

            if rows:
                with db.conn.cursor() as cur:
                    psycopg2.extras.execute_batch(
                        cur, _UPSERT_SQL, rows, page_size=500
                    )
                db.conn.commit()
                ok += len(rows)

            done = min(batch_start + batch_size, len(resolved_targets))
            log.info(
                f"{done}/{len(resolved_targets)} fetched "
                f"(upserted={ok}, no-stats={missing}, skipped={skipped})"
            )

        log.info(
            f"Done — upserted={ok}, no-stats={missing}, skipped={skipped}, "
            f"total={len(targets)}"
        )
    finally:
        db.close()


def main() -> None:
    ap = argparse.ArgumentParser(description="Backfill Sofascore per-player season stats")
    ap.add_argument("--league", type=int, help="FotMob league id (optional filter)")
    ap.add_argument("--season", type=str, help="Season string e.g. 2025/2026 (optional filter)")
    ap.add_argument("--concurrency", type=int, default=8, help="Concurrent in-flight HTTP requests")
    ap.add_argument("--batch-size", type=int, default=200, help="Targets per fetch+upsert batch")
    ap.add_argument("--limit", type=int, help="Cap number of targets, useful for smoke tests")
    ap.add_argument(
        "--stale-days",
        type=int,
        default=7,
        help="With skip-populated, re-fetch rows older than this many days; 0 disables age-based refresh",
    )
    ap.add_argument(
        "--no-skip-populated",
        action="store_true",
        help="Re-fetch every discovered player-season row, even if it is already current",
    )
    args = ap.parse_args()
    backfill(
        fotmob_id=args.league,
        season=args.season,
        concurrency=args.concurrency,
        batch_size=args.batch_size,
        limit=args.limit,
        skip_populated=not args.no_skip_populated,
        stale_days=args.stale_days,
    )


if __name__ == "__main__":
    main()
