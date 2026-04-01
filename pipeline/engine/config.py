"""Load rating configuration for positions."""

import json
from pathlib import Path

CONFIG_DIR = Path(__file__).resolve().parent.parent.parent / "config" / "positions"


def load_position_config(position: str) -> dict:
    """Load the rating config JSON for a given position."""
    path = CONFIG_DIR / f"{position.upper()}.json"
    if not path.exists():
        raise FileNotFoundError(f"No rating config for position: {position}")
    with open(path) as f:
        return json.load(f)


def get_available_positions() -> list[str]:
    """Return list of positions that have rating configs."""
    return [p.stem for p in CONFIG_DIR.glob("*.json")]
