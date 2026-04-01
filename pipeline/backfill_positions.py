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
from pipeline.scrapers.sofascore import fetch_player_profile, _POSITIONS_DETAILED_MAP

log = get_logger("backfill_positions")


def backfill_positions(batch_size: int = 50, delay: float = 2.0):
    """
    Backfill detailed positions for all players.

    Args:
        batch_size: Number of players to process before logging progress
        delay: Seconds to wait between API calls (rate limiting)
    """
    db = DB()

    # Find all players with Sofascore ID to refresh their position
    rows = db.query(
        """SELECT id, name, sofascore_id, position
           FROM players
           WHERE sofascore_id IS NOT NULL""",
        (),
    )

    if not rows:
        log.info("No players with Sofascore ID found")
        db.close()
        return

    log.info(f"Refreshing positions for {len(rows)} players")

    updated = 0
    failed = 0

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
                    log.debug(f"{name}: {current_pos} → {new_pos}")
                # else: position unchanged, no update needed
            else:
                log.warning(f"{name}: no position in profile")
                failed += 1

            # Rate limiting
            time.sleep(delay)

            # Progress logging
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
    backfill_positions()
