"""
Historical backfill script.

Scrapes and rates data for current + 2 previous seasons across all leagues.
Run manually — may take hours due to rate limiting.

Usage:
    python -m pipeline.backfill [--league LEAGUE_NAME] [--season SEASON]
"""

import argparse
import sys

from pipeline.db import DB
from pipeline.logger import get_logger
from pipeline.leagues import LEAGUES
from pipeline.scrape import scrape_league, get_existing_match_ids

log = get_logger("backfill")

SEASONS = ["2023/2024", "2024/2025", "2025/2026"]


def main():
    parser = argparse.ArgumentParser(description="Know Ball historical backfill")
    parser.add_argument(
        "--league", type=int, help="FotMob league ID (e.g. 47=PL, 48=Champ, 87=LaLiga, 53=L1, 55=SerieA, 54=BL)"
    )
    parser.add_argument(
        "--season", type=str, help="Specific season to backfill (e.g. 2024/2025)"
    )
    args = parser.parse_args()

    db = DB()
    existing_ids = get_existing_match_ids(db)
    log.info(f"Starting backfill. {len(existing_ids)} matches already in DB.")

    seasons = [args.season] if args.season else SEASONS
    leagues = LEAGUES

    if args.league:
        leagues = [l for l in LEAGUES if l[1] == args.league]
        if not leagues:
            log.error(f"Unknown FotMob league ID: {args.league}")
            log.info(f"Available: {[(name, fid) for name, fid, _ in LEAGUES]}")
            sys.exit(1)

    total_new = 0
    for season in seasons:
        for league_name, fotmob_id, understat_slug in leagues:
            log.info(f"--- Backfilling {league_name} {season} ---")
            try:
                before = len(existing_ids)
                scrape_league(
                    db,
                    league_name,
                    fotmob_id,
                    understat_slug,
                    season,
                    existing_ids,
                )
                existing_ids = get_existing_match_ids(db)
                added = len(existing_ids) - before
                total_new += added
                log.info(f"Added {added} matches for {league_name} {season}")
            except Exception as e:
                log.error(f"Backfill failed for {league_name} {season}: {e}")
                continue

    db.close()
    log.info(f"Backfill complete. {total_new} total new matches added.")
    log.info("Run 'python -m pipeline.rate' to calculate ratings for new data.")


if __name__ == "__main__":
    main()
