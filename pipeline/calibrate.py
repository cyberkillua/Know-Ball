"""
Calibration script for rating normalization.

Pulls all existing raw category scores from match_ratings for a given position,
computes median + IQR for each category, prints the new midpoints block,
and optionally writes them directly into the position config JSON.

Usage:
  python -m pipeline.calibrate                    # ST (default), print only
  python -m pipeline.calibrate --position W       # Winger, print only
  python -m pipeline.calibrate --position W --write  # Winger, update W.json
"""

import json
import sys
from pathlib import Path

from pipeline.db import DB
from pipeline.engine.normalizer import calibrate_from_raw_scores
from pipeline.logger import get_logger

log = get_logger("calibrate")

CONFIG_DIR = Path(__file__).parent.parent / "config" / "positions"

# Dimension columns per position in match_ratings
POSITION_DIMENSIONS: dict[str, list[str]] = {
    "ST": [
        "finishing",
        "shot_generation",
        "chance_creation",
        "team_function",
        "carrying",
        "duels",
        "defensive",
    ],
    "W": [
        "productive_dribbling",
        "chance_creation",
        "goal_contribution",
        "carrying",
        "shot_generation",
        "defensive",
        "presence",
    ],
}


def main():
    write = "--write" in sys.argv

    # Parse --position flag
    position = "ST"
    if "--position" in sys.argv:
        idx = sys.argv.index("--position")
        if idx + 1 < len(sys.argv):
            position = sys.argv[idx + 1].upper()

    if position not in POSITION_DIMENSIONS:
        log.error(
            f"Unknown position '{position}'. "
            f"Available: {', '.join(POSITION_DIMENSIONS.keys())}"
        )
        sys.exit(1)

    dimensions = POSITION_DIMENSIONS[position]
    config_path = CONFIG_DIR / f"{position}.json"

    if not config_path.exists():
        log.error(f"Config file not found: {config_path}")
        sys.exit(1)

    db = DB()
    log.info(f"Fetching {position} raw scores from match_ratings")

    cols = ", ".join(f"{d}_raw" for d in dimensions)
    rows = db.query(f"""
        SELECT {cols}
        FROM match_ratings
        WHERE position = %s
    """, (position,))
    db.close()

    if not rows:
        log.error(f"No {position} ratings found — run pipeline.rate first")
        sys.exit(1)

    log.info(f"Found {len(rows)} {position} match ratings")

    raw_by_category = {
        d: [float(r[f"{d}_raw"]) for r in rows if r[f"{d}_raw"] is not None]
        for d in dimensions
    }

    midpoints = calibrate_from_raw_scores(raw_by_category)

    # Print results
    print(f"\nCalibrated midpoints for {position}:")
    print("-" * 58)
    for cat, stats in midpoints.items():
        print(f"  {cat:24s}  median={stats['median']:+.4f}  scale={stats['scale']:.4f}"
              f"  (n={stats['n']}, range=[{stats['min']:.3f}, {stats['max']:.3f}])")
    print()

    # JSON block ready to paste / write
    midpoints_for_config = {
        cat: {"median": stats["median"], "scale": stats["scale"]}
        for cat, stats in midpoints.items()
    }

    if write:
        import datetime
        config = json.loads(config_path.read_text())
        config["normalization"]["midpoints"] = midpoints_for_config
        config["normalization"]["calibrated_at"] = datetime.date.today().isoformat()
        config["normalization"]["sample_size"] = len(rows)
        config_path.write_text(json.dumps(config, indent=2) + "\n")
        log.info(f"Updated {config_path}")
    else:
        print(f"Paste into {position}.json → normalization.midpoints:")
        print(json.dumps(midpoints_for_config, indent=4))
        print("\nRe-run with --write to update the file automatically.")


if __name__ == "__main__":
    main()
