"""
Calibration script for ST rating normalization.

Pulls all existing raw category scores from match_ratings (position = 'ST'),
computes median + IQR for each category, prints the new midpoints block,
and optionally writes them directly into config/positions/ST.json.

Usage:
  python -m pipeline.calibrate           # print only
  python -m pipeline.calibrate --write   # print and update ST.json
"""

import json
import sys
from pathlib import Path

from pipeline.db import DB
from pipeline.engine.normalizer import calibrate_from_raw_scores
from pipeline.logger import get_logger

log = get_logger("calibrate")

CONFIG_PATH = Path(__file__).parent.parent / "config" / "positions" / "ST.json"


def main():
    write = "--write" in sys.argv

    db = DB()
    log.info("Fetching ST raw scores from match_ratings")

    rows = db.query("""
        SELECT finishing_raw, creation_raw, involvement_raw, carrying_raw, physical_raw, pressing_raw
        FROM match_ratings
        WHERE position = 'ST'
    """)
    db.close()

    if not rows:
        log.error("No ST ratings found — run pipeline.rate first")
        sys.exit(1)

    log.info(f"Found {len(rows)} ST match ratings")

    raw_by_category = {
        "finishing":   [float(r["finishing_raw"])   for r in rows],
        "creation":    [float(r["creation_raw"])    for r in rows],
        "involvement": [float(r["involvement_raw"]) for r in rows],
        "carrying":    [float(r["carrying_raw"])    for r in rows],
        "physical":    [float(r["physical_raw"])    for r in rows],
        "pressing":    [float(r["pressing_raw"])    for r in rows],
    }

    midpoints = calibrate_from_raw_scores(raw_by_category)

    # Print results
    print("\nCalibrated midpoints:")
    print("-" * 48)
    for cat, stats in midpoints.items():
        print(f"  {cat:12s}  median={stats['median']:+.4f}  scale={stats['scale']:.4f}"
              f"  (n={stats['n']}, range=[{stats['min']:.3f}, {stats['max']:.3f}])")
    print()

    # JSON block ready to paste / write
    midpoints_for_config = {
        cat: {"median": stats["median"], "scale": stats["scale"]}
        for cat, stats in midpoints.items()
    }

    if write:
        import datetime
        config = json.loads(CONFIG_PATH.read_text())
        config["normalization"]["midpoints"] = midpoints_for_config
        config["normalization"]["calibrated_at"] = datetime.date.today().isoformat()
        config["normalization"]["sample_size"] = len(rows)
        CONFIG_PATH.write_text(json.dumps(config, indent=2) + "\n")
        log.info(f"Updated {CONFIG_PATH}")
    else:
        print("Paste into ST.json → normalization.midpoints:")
        print(json.dumps(midpoints_for_config, indent=4))
        print("\nRe-run with --write to update the file automatically.")


if __name__ == "__main__":
    main()
