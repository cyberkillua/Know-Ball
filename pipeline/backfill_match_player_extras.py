"""
Backfill new match_player_stats columns for already-scraped matches.

Re-fetches event/{id}/lineups for every match with a sofascore_id and
UPDATEs only the columns added by migrations 036 + 037:

  - accurate_own_half_passes
  - total_own_half_passes
  - accurate_opposition_half_passes
  - total_opposition_half_passes
  - pass_value_normalized
  - total_ball_carries_distance
  - total_progressive_ball_carries_distance

Optimised for throughput:
  - Concurrent async lineup fetches (semaphore-bounded, rate-limited
    via the existing token bucket).
  - Bulk UPDATE FROM VALUES via execute_values — a single round-trip
    per processed batch instead of per-row UPDATEs.
  - --skip-populated by default: matches with any populated row are
    skipped entirely (idempotent re-runs cost nothing).

Usage:
    python -m pipeline.backfill_match_player_extras
    python -m pipeline.backfill_match_player_extras --no-skip-populated
    python -m pipeline.backfill_match_player_extras --league 47 --season 2025/2026
    python -m pipeline.backfill_match_player_extras --concurrency 16 --batch-size 100
"""

import argparse
import asyncio
import time

import psycopg2.extras
from curl_cffi.requests import AsyncSession

from pipeline.db import DB
from pipeline.logger import get_logger
from pipeline.scrapers.sofascore import _api_get_async

log = get_logger("backfill_match_player_extras")


_BULK_UPDATE_SQL = """
UPDATE match_player_stats AS mps SET
  accurate_own_half_passes                = v.accurate_own_half_passes::int,
  total_own_half_passes                   = v.total_own_half_passes::int,
  accurate_opposition_half_passes         = v.accurate_opposition_half_passes::int,
  total_opposition_half_passes            = v.total_opposition_half_passes::int,
  pass_value_normalized                   = v.pass_value_normalized::numeric,
  total_ball_carries_distance             = v.total_ball_carries_distance::numeric,
  total_progressive_ball_carries_distance = v.total_progressive_ball_carries_distance::numeric
FROM (VALUES %s) AS v(
  match_id, player_id,
  accurate_own_half_passes, total_own_half_passes,
  accurate_opposition_half_passes, total_opposition_half_passes,
  pass_value_normalized,
  total_ball_carries_distance, total_progressive_ball_carries_distance
)
WHERE mps.match_id = v.match_id::int AND mps.player_id = v.player_id::int
"""


def _extract_extras(lineups: dict) -> list[tuple]:
    """Return (sofascore_player_id, *7 fields) tuples from a lineups payload."""
    out = []
    for side in ("home", "away"):
        for player in lineups.get(side, {}).get("players", []) or []:
            stats = player.get("statistics") or {}
            mins = stats.get("minutesPlayed", 0) or 0
            if mins <= 0:
                continue
            pid = (player.get("player") or {}).get("id")
            if not pid:
                continue

            aohp = stats.get("accurateOwnHalfPasses", 0) or 0
            tohp = stats.get("totalOwnHalfPasses", 0) or 0
            aopp = stats.get("accurateOppositionHalfPasses", 0) or 0
            topp = stats.get("totalOppositionHalfPasses", 0) or 0
            pvn = stats.get("passValueNormalized")
            tbcd = stats.get("totalBallCarriesDistance", 0) or 0
            tpbcd = stats.get("totalProgressiveBallCarriesDistance", 0) or 0

            # Skip rows with nothing to write — saves bulk-update bandwidth.
            if not (aohp or tohp or aopp or topp or pvn or tbcd or tpbcd):
                continue

            out.append((pid, aohp, tohp, aopp, topp, pvn, tbcd, tpbcd))
    return out


async def _fetch_one(
    session: AsyncSession,
    semaphore: asyncio.Semaphore,
    match_id: int,
    sofascore_id: int,
) -> tuple[int, dict | None]:
    async with semaphore:
        try:
            data = await _api_get_async(f"event/{sofascore_id}/lineups", session)
            return match_id, data
        except Exception as e:
            log.warning(f"match {match_id} (sofa {sofascore_id}) fetch failed: {e}")
            return match_id, None


async def _fetch_batch(
    matches: list[dict], concurrency: int
) -> list[tuple[int, dict | None]]:
    semaphore = asyncio.Semaphore(concurrency)
    async with AsyncSession() as session:
        tasks = [
            _fetch_one(session, semaphore, m["match_id"], m["sofascore_id"])
            for m in matches
        ]
        return await asyncio.gather(*tasks)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--league", type=int, help="Filter by league id")
    parser.add_argument("--season", type=str, help="Filter by season (e.g. 2025/2026)")
    parser.add_argument(
        "--no-skip-populated",
        action="store_true",
        help="Re-fetch even matches that already have data (default: skip)",
    )
    parser.add_argument(
        "--concurrency", type=int, default=16,
        help="Concurrent in-flight HTTP requests (default 16; rate-limited by token bucket)",
    )
    parser.add_argument(
        "--batch-size", type=int, default=200,
        help="Matches per fetch+commit batch (default 200)",
    )
    parser.add_argument("--limit", type=int, default=None, help="Cap number of matches")
    args = parser.parse_args()

    db = DB()
    skip_populated = not args.no_skip_populated

    where = ["m.sofascore_id IS NOT NULL"]
    params: list = []
    if args.league:
        where.append("m.league_id = %s")
        params.append(args.league)
    if args.season:
        where.append("m.season = %s")
        params.append(args.season)
    if skip_populated:
        where.append(
            "NOT EXISTS (SELECT 1 FROM match_player_stats mps "
            "WHERE mps.match_id = m.id "
            "AND (mps.total_progressive_ball_carries_distance > 0 "
            "     OR mps.pass_value_normalized IS NOT NULL) "
            "LIMIT 1)"
        )

    sql = f"""
        SELECT m.id AS match_id, m.sofascore_id
        FROM matches m
        WHERE {' AND '.join(where)}
        ORDER BY m.date DESC
    """
    if args.limit:
        sql += f" LIMIT {int(args.limit)}"

    matches = db.query(sql, tuple(params))
    log.info(
        f"Discovered {len(matches)} matches to backfill "
        f"(skip_populated={skip_populated}, concurrency={args.concurrency}, "
        f"batch_size={args.batch_size})"
    )
    if not matches:
        db.close()
        return

    # Cache players once: sofascore_id -> db id
    player_rows = db.query(
        "SELECT id, sofascore_id FROM players WHERE sofascore_id IS NOT NULL"
    )
    pid_map = {r["sofascore_id"]: r["id"] for r in player_rows}
    log.info(f"Loaded {len(pid_map)} player id mappings")

    started = time.time()
    total_updated = 0
    total_matches_done = 0

    for batch_start in range(0, len(matches), args.batch_size):
        batch = matches[batch_start : batch_start + args.batch_size]
        results = asyncio.run(_fetch_batch(batch, args.concurrency))

        bulk_rows: list[tuple] = []
        for match_id, lineups in results:
            if not lineups:
                continue
            for entry in _extract_extras(lineups):
                sofa_pid, *fields = entry
                db_pid = pid_map.get(sofa_pid)
                if not db_pid:
                    continue
                bulk_rows.append((match_id, db_pid, *fields))

        if bulk_rows:
            with db.conn.cursor() as cur:
                psycopg2.extras.execute_values(
                    cur, _BULK_UPDATE_SQL, bulk_rows, page_size=1000
                )
            db.conn.commit()
            total_updated += len(bulk_rows)

        total_matches_done += len(batch)
        elapsed = time.time() - started
        rate = total_matches_done / max(elapsed, 1e-6)
        eta = (len(matches) - total_matches_done) / max(rate, 1e-6)
        log.info(
            f"[{total_matches_done}/{len(matches)}] "
            f"updated {total_updated} rows | {rate:.1f} matches/s | ETA {eta:.0f}s"
        )

    log.info(
        f"Done. {total_updated} player-rows updated across {len(matches)} matches "
        f"in {time.time() - started:.1f}s"
    )
    db.close()


if __name__ == "__main__":
    main()
