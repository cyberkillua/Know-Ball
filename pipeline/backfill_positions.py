#!/usr/bin/env python3
"""
Backfill player positions from Sofascore player profiles.

Run once to populate detailed positions (GK, RB, CAM, ST, etc.) for all
existing players who currently have basic positions (G, D, M, F).

Usage:
    python3 -m pipeline.backfill_positions
"""

import time
from pipeline.db import DB
from pipeline.logger import get_logger
from pipeline.scrapers.sofascore import (
    fetch_player_profile,
    fetch_player_profiles_batch,
)

log = get_logger("backfill_positions")


def backfill_positions(
    batch_size: int = 50, delay: float = 1.0, use_async: bool = True
):
    """
    Backfill detailed positions for all players.

    Args:
        batch_size: Number of players to process before logging progress
        delay: Seconds to wait between API calls (only for sync mode)
        use_async: Use async batch fetching for better performance
    """
    db = DB()

    rows = db.query(
        """SELECT id, name, sofascore_id, position
           FROM players
           WHERE sofascore_id IS NOT NULL
           AND (position IS NULL OR position IN ('G', 'D', 'M', 'F'))""",
        (),
    )

    if not rows:
        log.info("No players with missing/basic positions found")
        db.close()
        return

    log.info(f"Refreshing positions for {len(rows)} players")

    updated = 0
    failed = 0

    if use_async and len(rows) > 10:
        import asyncio

        player_ids = [row["sofascore_id"] for row in rows]

        async def backfill_async():
            nonlocal updated, failed

            profiles = await fetch_player_profiles_batch(player_ids, max_concurrent=10)

            for row in rows:
                sofascore_id = row["sofascore_id"]
                name = row["name"]
                current_pos = row["position"]

                profile = profiles.get(sofascore_id)

                if profile and profile.get("position"):
                    new_pos = profile["position"]
                    if new_pos != current_pos:
                        try:
                            db.execute(
                                "UPDATE players SET position = %s WHERE id = %s",
                                (new_pos, row["id"]),
                            )
                            updated += 1
                            log.debug(f"{name}: {current_pos or 'NULL'} → {new_pos}")
                        except Exception as e:
                            log.error(f"{name}: failed to update - {e}")
                            failed += 1
                else:
                    log.warning(
                        f"{name}: no position from profile (current: {current_pos or 'NULL'})"
                    )
                    failed += 1

                if (rows.index(row) + 1) % batch_size == 0:
                    log.info(
                        f"Progress: {rows.index(row) + 1}/{len(rows)} "
                        f"({updated} updated, {failed} failed)"
                    )

        asyncio.run(backfill_async())
    else:
        for i, row in enumerate(rows, 1):
            player_id = row["id"]
            name = row["name"]
            sofascore_id = row["sofascore_id"]
            current_pos = row["position"]

            try:
                profile = fetch_player_profile(sofascore_id)
                if profile and profile.get("position"):
                    new_pos = profile["position"]
                    if new_pos != current_pos:
                        db.execute(
                            "UPDATE players SET position = %s WHERE id = %s",
                            (new_pos, player_id),
                        )
                        updated += 1
                        log.debug(f"{name}: {current_pos or 'NULL'} → {new_pos}")
                else:
                    log.warning(
                        f"{name}: no position from profile (current: {current_pos or 'NULL'})"
                    )
                    failed += 1

                time.sleep(delay)

                if i % batch_size == 0:
                    log.info(
                        f"Progress: {i}/{len(rows)} ({updated} updated, {failed} failed)"
                    )

            except Exception as e:
                log.error(f"{name}: failed to fetch profile - {e}")
                failed += 1
                time.sleep(delay)

    db.close()
    log.info(f"Backfill complete: {updated} updated, {failed} failed")


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Backfill player positions")
    parser.add_argument(
        "--sync",
        action="store_true",
        help="Use synchronous mode (slower but simpler)",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=50,
        help="Number of players to process before logging progress",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=1.0,
        help="Seconds to wait between API calls (sync mode only)",
    )

    args = parser.parse_args()

    backfill_positions(
        batch_size=args.batch_size,
        delay=args.delay,
        use_async=not args.sync,
    )
