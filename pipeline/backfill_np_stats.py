#!/usr/bin/env python3
"""
Backfill penalty_goals, np_xg, and np_shots for already-scraped match_player_stats rows.

Re-fetches incidents and shotmap from Sofascore for each match and computes:
  - penalty_goals: goals scored from the penalty spot (from incidents)
  - np_shots:      stored shots_total minus penalty shots (from shotmap)
  - np_xg:         stored xg minus (penalty_shots * 0.79)

Usage:
    python3 -m pipeline.backfill_np_stats             # all matches
    python3 -m pipeline.backfill_np_stats --league 47 # Premier League only
    python3 -m pipeline.backfill_np_stats --season "2024/2025"
    python3 -m pipeline.backfill_np_stats --dry-run
    python3 -m pipeline.backfill_np_stats --workers 5
"""

import json
import argparse
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed

from pipeline.db import DB
from pipeline.logger import get_logger
from pipeline.scrapers.sofascore import _api_get, _rate_limiter

log = get_logger("backfill_np_stats")

PENALTY_XG = 0.79

_thread_local = threading.local()


def _get_thread_db() -> DB:
    if not hasattr(_thread_local, "db"):
        _thread_local.db = DB()
    return _thread_local.db


def _process_match(
    match: dict,
    id_cache: dict[int, int],
    dry_run: bool,
) -> tuple[int, list[tuple], bool]:
    """
    Fetch incidents + shotmap for one match and compute np stat updates.

    Returns (match_db_id, list_of_(penalty_goals, np_xg, np_shots, match_id, player_id), success).
    """
    sofascore_id = match["sofascore_id"]
    match_db_id = match["id"]

    try:
        _rate_limiter.acquire_sync()
        incidents_data = _api_get(f"event/{sofascore_id}/incidents")
        incidents = incidents_data.get("incidents", []) if incidents_data else []

        _rate_limiter.acquire_sync()
        shotmap_data = _api_get(f"event/{sofascore_id}/shotmap")
        shotmap = shotmap_data.get("shotmap", []) if shotmap_data else []
    except Exception as e:
        log.warning(f"Match {sofascore_id}: failed to fetch data — {e}")
        return match_db_id, [], False

    # Count penalty goals per Sofascore player id
    penalty_goals_map: dict[int, int] = {}
    for inc in incidents:
        if inc.get("incidentType") == "goal" and inc.get("incidentClass") == "penalty":
            pid = inc.get("player", {}).get("id")
            if pid:
                penalty_goals_map[pid] = penalty_goals_map.get(pid, 0) + 1

    # Count penalty shots per Sofascore player id (to subtract from total shots and xg)
    penalty_shots_map: dict[int, int] = {}
    for shot in shotmap:
        if shot.get("situation") == "penalty":
            pid = shot.get("player", {}).get("id")
            if pid:
                penalty_shots_map[pid] = penalty_shots_map.get(pid, 0) + 1

    # Fetch stored stats for this match to compute np_xg and np_shots
    db = _get_thread_db()
    rows = db.query(
        """SELECT mps.player_id, p.sofascore_id, mps.xg, mps.shots_total
           FROM match_player_stats mps
           JOIN players p ON p.id = mps.player_id
           WHERE mps.match_id = %s AND p.sofascore_id IS NOT NULL""",
        (match_db_id,),
    )

    updates: list[tuple] = []
    for row in rows:
        sfa_pid = row["sofascore_id"]
        stored_xg = float(row["xg"] or 0)
        stored_shots = int(row["shots_total"] or 0)

        pg = penalty_goals_map.get(sfa_pid, 0)
        ps = penalty_shots_map.get(sfa_pid, 0)
        np_xg = max(0.0, round(stored_xg - ps * PENALTY_XG, 4))
        np_shots = max(0, stored_shots - ps)

        updates.append((pg, np_xg, np_shots, match_db_id, row["player_id"]))

    log.debug(f"Match {sofascore_id}: {len(updates)} player rows computed")
    return match_db_id, updates, True


def _flush_updates(db: DB, updates: list[tuple], dry_run: bool) -> int:
    if dry_run or not updates:
        return len(updates)

    db.execute(
        """UPDATE match_player_stats AS t
           SET penalty_goals = v.pg,
               np_xg = v.nxg,
               np_shots = v.ns
           FROM (VALUES %s) AS v(pg, nxg, ns, match_id, pid)
           WHERE t.match_id = v.match_id::int
             AND t.player_id = v.pid::int""",
        (updates,),
    )
    return len(updates)


def backfill(
    db: DB,
    league_id: int | None = None,
    season: str | None = None,
    dry_run: bool = False,
    batch_size: int = 50,
    workers: int = 5,
    chunk_size: int = 500,
    failed_output: str | None = None,
):
    filters = ["sofascore_id IS NOT NULL"]
    params: list = []

    if league_id:
        filters.append("league_id = %s")
        params.append(league_id)
    if season:
        filters.append("season = %s")
        params.append(season)

    where = " AND ".join(filters)

    # Pre-load player id mapping
    log.info("Loading player cache...")
    all_players = db.query(
        "SELECT id, sofascore_id FROM players WHERE sofascore_id IS NOT NULL"
    )
    id_cache: dict[int, int] = {r["sofascore_id"]: r["id"] for r in all_players}
    log.info(f"Cached {len(id_cache)} players")

    count_row = db.query_one(
        f"SELECT COUNT(*) AS n FROM matches WHERE {where}", tuple(params)
    )
    total = count_row["n"] if count_row else 0
    log.info(f"Found {total} matches to backfill")

    updated_total = 0
    failed_ids: list[int] = []
    offset = 0

    try:
        with ThreadPoolExecutor(max_workers=workers) as pool:
            while offset < total:
                chunk = db.query(
                    f"SELECT id, sofascore_id FROM matches WHERE {where} ORDER BY date LIMIT %s OFFSET %s",
                    tuple(params) + (chunk_size, offset),
                )
                offset += len(chunk)
                if not chunk:
                    break

                pending_updates: list[tuple] = []
                futures = {
                    pool.submit(_process_match, m, id_cache, dry_run): m for m in chunk
                }

                for i, fut in enumerate(as_completed(futures), 1):
                    try:
                        match_db_id, updates, ok = fut.result()
                        if not ok:
                            failed_ids.append(match_db_id)
                        else:
                            pending_updates.extend(updates)
                    except Exception as e:
                        m = futures[fut]
                        log.error(f"Match {m['sofascore_id']}: {e}")
                        failed_ids.append(m["id"])

                    if (offset - len(chunk) + i) % batch_size == 0:
                        log.info(
                            f"Progress: {offset - len(chunk) + i}/{total} matches | "
                            f"{updated_total + len(pending_updates)} rows staged"
                        )

                updated_total += _flush_updates(db, pending_updates, dry_run)
                log.info(
                    f"Chunk complete ({offset}/{total}): "
                    f"{len(pending_updates)} rows {'staged' if dry_run else 'written'}"
                )

    finally:
        for attr in ("db",):
            db_obj = getattr(_thread_local, attr, None)
            if db_obj:
                try:
                    db_obj.close()
                except Exception:
                    pass

    if failed_ids and failed_output:
        with open(failed_output, "w") as f:
            json.dump(failed_ids, f)
        log.info(f"Wrote {len(failed_ids)} failed match IDs to {failed_output}")

    action = "Would update" if dry_run else "Updated"
    log.info(
        f"Done. {action} {updated_total} rows across {total - len(failed_ids)} matches. "
        f"{len(failed_ids)} matches failed."
    )


def main():
    parser = argparse.ArgumentParser(
        description="Backfill penalty_goals, np_xg, np_shots"
    )
    parser.add_argument("--league", type=int, help="DB league id to filter")
    parser.add_argument("--season", type=str, help='Season string e.g. "2024/2025"')
    parser.add_argument(
        "--dry-run", action="store_true", help="Print counts without writing"
    )
    parser.add_argument(
        "--batch-size", type=int, default=50, help="Progress log interval"
    )
    parser.add_argument("--workers", type=int, default=5, help="Concurrent API workers")
    parser.add_argument(
        "--chunk-size", type=int, default=500, help="Matches fetched per DB page"
    )
    parser.add_argument(
        "--failed-output",
        type=str,
        default=None,
        help="JSON file to write failed match IDs for retry",
    )
    args = parser.parse_args()

    db = DB()
    try:
        backfill(
            db,
            league_id=args.league,
            season=args.season,
            dry_run=args.dry_run,
            batch_size=args.batch_size,
            workers=args.workers,
            chunk_size=args.chunk_size,
            failed_output=args.failed_output,
        )
    finally:
        db.close()


if __name__ == "__main__":
    main()
