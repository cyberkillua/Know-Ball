"""Shared editable pipeline settings.

Values come from config/pipeline.toml at the repository root. Keep CLI flags
as the final authority in individual scripts; this module only provides sane
defaults that can be edited in one place.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import os
import tomllib


CONFIG_PATH = Path(__file__).resolve().parents[2] / "config" / "pipeline.toml"


@dataclass(frozen=True)
class DailySettings:
    recent_days: int = 2
    season_stats_concurrency: int = 8
    season_stats_batch_size: int = 200


@dataclass(frozen=True)
class BackfillSettings:
    match_player_extras_concurrency: int = 16
    match_player_extras_batch_size: int = 200
    player_season_sofascore_concurrency: int = 8
    player_season_sofascore_batch_size: int = 200
    player_season_sofascore_stale_days: int = 7


@dataclass(frozen=True)
class PipelineSettings:
    current_season: str = "2025/2026"
    daily: DailySettings = DailySettings()
    backfills: BackfillSettings = BackfillSettings()


def _int_value(data: dict, key: str, default: int) -> int:
    raw = data.get(key, default)
    try:
        return int(raw)
    except (TypeError, ValueError):
        return default


def load_settings() -> PipelineSettings:
    data: dict = {}
    if CONFIG_PATH.exists():
        with CONFIG_PATH.open("rb") as f:
            data = tomllib.load(f)

    daily = data.get("daily") or {}
    backfills = data.get("backfills") or {}

    current_season = (
        os.getenv("CURRENT_SEASON")
        or str(data.get("current_season") or PipelineSettings.current_season)
    )

    return PipelineSettings(
        current_season=current_season,
        daily=DailySettings(
            recent_days=_int_value(daily, "recent_days", DailySettings.recent_days),
            season_stats_concurrency=_int_value(
                daily,
                "season_stats_concurrency",
                DailySettings.season_stats_concurrency,
            ),
            season_stats_batch_size=_int_value(
                daily,
                "season_stats_batch_size",
                DailySettings.season_stats_batch_size,
            ),
        ),
        backfills=BackfillSettings(
            match_player_extras_concurrency=_int_value(
                backfills,
                "match_player_extras_concurrency",
                BackfillSettings.match_player_extras_concurrency,
            ),
            match_player_extras_batch_size=_int_value(
                backfills,
                "match_player_extras_batch_size",
                BackfillSettings.match_player_extras_batch_size,
            ),
            player_season_sofascore_concurrency=_int_value(
                backfills,
                "player_season_sofascore_concurrency",
                BackfillSettings.player_season_sofascore_concurrency,
            ),
            player_season_sofascore_batch_size=_int_value(
                backfills,
                "player_season_sofascore_batch_size",
                BackfillSettings.player_season_sofascore_batch_size,
            ),
            player_season_sofascore_stale_days=_int_value(
                backfills,
                "player_season_sofascore_stale_days",
                BackfillSettings.player_season_sofascore_stale_days,
            ),
        ),
    )


SETTINGS = load_settings()
