#!/usr/bin/env python3
"""
Backfill position_played for already-scraped match_player_stats rows.

Re-fetches lineups from Sofascore and re-runs the cost-matrix position
assignment using stored player profile positions, then updates the DB.

Usage:
    python3 -m pipeline.backfill_match_positions             # all matches
    python3 -m pipeline.backfill_match_positions --league 47 # Premier League only
    python3 -m pipeline.backfill_match_positions --season "2024/2025"
    python3 -m pipeline.backfill_match_positions --dry-run
    python3 -m pipeline.backfill_match_positions --workers 10
    python3 -m pipeline.backfill_match_positions --chunk-size 500
"""

import json
import argparse
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed

from pipeline.db import DB
from pipeline.logger import get_logger
from pipeline.scrapers.sofascore import (
    fetch_match_details,
    _infer_positions_from_formation,
    _assign_formation_positions,
    _basic_pos,
    _rate_limiter,
)

log = get_logger("backfill_match_positions")

# Thread-local DB connections so each worker has its own connection
_thread_local = threading.local()


def _get_thread_db() -> DB:
    if not hasattr(_thread_local, "db"):
        _thread_local.db = DB()
    return _thread_local.db


def _close_thread_dbs(dbs: list[DB]) -> None:
    for db in dbs:
        try:
            db.close()
        except Exception:
            pass


def _infer_positions_for_match(detail: dict, profile_map: dict[int, str]) -> dict[int, str]:
    """
    Return sofascore_player_id → position_played for every player in the match.
    Mirrors the logic in extract_player_stats.
    """
    lineups = detail.get("lineups", {})
    incidents = detail.get("incidents", [])

    sub_map_in_to_out: dict[int, int] = {}
    for inc in incidents:
        if inc.get("incidentType") == "substitution":
            pin = inc.get("playerIn", {})
            pout = inc.get("playerOut", {})
            if pin.get("id") and pout.get("id"):
                sub_map_in_to_out[pin["id"]] = pout["id"]

    result: dict[int, str] = {}

    for side in ("home", "away"):
        team_data = lineups.get(side, {})
        formation = team_data.get("formation", "")
        team_players = team_data.get("players", [])

        starters = [p for p in team_players if not p.get("substitute", False)]

        formation_positions = _infer_positions_from_formation(formation, starters)
        starter_pos_map = _assign_formation_positions(
            formation_positions, starters, profile_map
        )

        for player in team_players:
            pid = player.get("player", {}).get("id")
            if not pid:
                continue

            is_sub = player.get("substitute", False)

            if not is_sub:
                pos = starter_pos_map.get(pid)
            else:
                replaced_pid = sub_map_in_to_out.get(pid)
                if replaced_pid and replaced_pid in starter_pos_map:
                    pos = starter_pos_map[replaced_pid]
                else:
                    pos = {"G": "GK", "D": "CB", "M": "CM", "F": "ST"}.get(
                        _basic_pos(player), "CM"
                    )

            if pos:
                result[pid] = pos

    return result


def _process_match(
    match: dict,
    profile_cache: dict[int, str],
    id_cache: dict[int, int],
    dry_run: bool,
) -> tuple[int, list[tuple], bool]:
    """
    Fetch lineups for one match and compute position updates.

    Returns (match_db_id, list_of_(position, match_id, player_id) tuples, success).
    Thread-safe: uses _rate_limiter and read-only shared caches.
    """
    sofascore_id = match["sofascore_id"]
    match_db_id = match["id"]

    _rate_limiter.acquire_sync()
    detail = fetch_match_details(sofascore_id)
    if not detail:
        log.warning(f"Match {sofascore_id}: no lineup data, skipping")
        return match_db_id, [], False

    all_pids: list[int] = []
    for side in ("home", "away"):
        for p in detail.get("lineups", {}).get(side, {}).get("players", []):
            pid = p.get("player", {}).get("id")
            if pid:
                all_pids.append(pid)

    # Use pre-loaded caches — no DB queries per match
    profile_map = {pid: profile_cache[pid] for pid in all_pids if pid in profile_cache}
    new_positions = _infer_positions_for_match(detail, profile_map)

    updates: list[tuple] = []
    for sfa_pid, position in new_positions.items():
        db_pid = id_cache.get(sfa_pid)
        if db_pid:
            updates.append((position, match_db_id, db_pid))

    log.debug(f"Match {sofascore_id}: {len(updates)} player positions resolved")
    return match_db_id, updates, True


def _flush_updates(db: DB, updates: list[tuple], dry_run: bool) -> int:
    """Write a batch of (position, match_id, player_id) tuples to the DB."""
    if dry_run or not updates:
        return len(updates)

    # execute_values path: db.execute() triggers it when params[0] is a list of tuples
    db.execute(
        """UPDATE match_player_stats AS t
           SET position_played = v.pos
           FROM (VALUES %s) AS v(pos, match_id, pid)
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

    # --- Pre-load full player table once ---
    log.info("Loading player cache...")
    all_players = db.query(
        "SELECT id, sofascore_id, position FROM players WHERE sofascore_id IS NOT NULL"
    )
    profile_cache: dict[int, str] = {
        r["sofascore_id"]: r["position"]
        for r in all_players
        if r["position"] and r["position"] not in ("G", "D", "M", "F")
    }
    id_cache: dict[int, int] = {r["sofascore_id"]: r["id"] for r in all_players}
    log.info(f"Cached {len(id_cache)} players ({len(profile_cache)} with detailed positions)")

    # --- Count total without loading everything at once ---
    count_row = db.query_one(f"SELECT COUNT(*) AS n FROM matches WHERE {where}", tuple(params))
    total = count_row["n"] if count_row else 0
    log.info(f"Found {total} matches to backfill")

    updated_total = 0
    failed_ids: list[int] = []
    offset = 0

    thread_dbs: list[DB] = []

    try:
        with ThreadPoolExecutor(max_workers=workers) as pool:
            while offset < total:
                # Stream matches in chunks to avoid loading all into memory
                chunk = db.query(
                    f"SELECT id, sofascore_id FROM matches WHERE {where} ORDER BY date LIMIT %s OFFSET %s",
                    tuple(params) + (chunk_size, offset),
                )
                offset += len(chunk)
                if not chunk:
                    break

                pending_updates: list[tuple] = []
                futures = {
                    pool.submit(_process_match, m, profile_cache, id_cache, dry_run): m
                    for m in chunk
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

                # Batch-write all updates for this chunk
                updated_total += _flush_updates(db, pending_updates, dry_run)
                log.info(
                    f"Chunk complete ({offset}/{total}): "
                    f"{len(pending_updates)} rows {'staged' if dry_run else 'written'}"
                )

    finally:
        _close_thread_dbs(thread_dbs)

    if failed_ids and failed_output:
        with open(failed_output, "w") as f:
            json.dump(failed_ids, f)
        log.info(f"Wrote {len(failed_ids)} failed match IDs to {failed_output}")

    action = "Would update" if dry_run else "Updated"
    log.info(
        f"Done. {action} {updated_total} position_played rows. "
        f"{len(failed_ids)} matches failed."
    )


def main():
    parser = argparse.ArgumentParser(description="Backfill match position_played")
    parser.add_argument("--league", type=int, help="DB league id to filter")
    parser.add_argument("--season", type=str, help='Season string e.g. "2024/2025"')
    parser.add_argument("--dry-run", action="store_true", help="Print counts without writing")
    parser.add_argument("--batch-size", type=int, default=50, help="Progress log interval")
    parser.add_argument("--workers", type=int, default=5, help="Concurrent API workers")
    parser.add_argument("--chunk-size", type=int, default=500, help="Matches fetched per DB page")
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
