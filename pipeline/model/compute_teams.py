"""Build league-relative team style profiles for the team page."""

import argparse
import json
from collections import defaultdict
from pathlib import Path

import psycopg2.extras

from pipeline.core.db import DB
from pipeline.core.leagues import CURRENT_SEASON
from pipeline.core.logger import get_logger
from pipeline.model.compute import percentile_of, sorted_vals

log = get_logger("compute_teams")

CONFIG_PATH = (
    Path(__file__).resolve().parents[2] / "config" / "ratings" / "team_analysis.json"
)

DEFAULT_CONFIG = {
    "style": {
        "strength_percentile_min": 60,
        "weakness_percentile_max": 40,
        "max_items": 4,
        "phase_items": 2,
        "phase_relative_strength_percentile_min": 50,
        "phase_improvement_percentile_max": 89,
    },
}


def _merge(default: dict, override: dict) -> dict:
    out = dict(default)
    for key, value in override.items():
        if key.startswith("_"):
            continue
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = _merge(out[key], value)
        else:
            out[key] = value
    return out


def load_team_config() -> dict:
    if CONFIG_PATH.exists():
        with CONFIG_PATH.open() as config_file:
            return _merge(DEFAULT_CONFIG, json.load(config_file))
    return DEFAULT_CONFIG


CFG = load_team_config()

# (key, label, higher_is_better). Percentiles are expressed so 100 is always good.
STYLE_METRICS: list[tuple[str, str, bool]] = [
    ("xg_for", "Expected goals created", True),
    ("shots_for", "Shot volume", True),
    ("big_chances_for", "Big chances created", True),
    ("key_passes_for", "Key passes", True),
    ("goals_for", "Goals scored", True),
    ("finishing_overperformance", "Finishing vs xG", True),
    ("possession", "Possession", True),
    ("passes_for", "Passing volume", True),
    ("pass_accuracy", "Passing accuracy", True),
    ("goals_against", "Goals conceded", False),
    ("xg_against", "Expected goals conceded", False),
    ("shots_against", "Shots conceded", False),
    ("big_chances_against", "Big chances conceded", False),
]

STYLE_AXES: dict[str, list[str]] = {
    "attack": [
        "xg_for",
        "shots_for",
        "big_chances_for",
        "goals_for",
        "finishing_overperformance",
    ],
    "midfield": ["key_passes_for", "possession", "passes_for", "pass_accuracy"],
    "defence": [
        "goals_against",
        "xg_against",
        "shots_against",
        "big_chances_against",
    ],
}

PHASES: dict[str, dict[str, object]] = {
    "attack": {
        "label": "Attack",
        "metrics": STYLE_AXES["attack"],
    },
    "midfield": {
        "label": "Midfield & control",
        "metrics": STYLE_AXES["midfield"],
    },
    "defence": {
        "label": "Defence",
        "metrics": STYLE_AXES["defence"],
    },
}

METRIC_LABELS = {key: label for key, label, _ in STYLE_METRICS}


def _metric_item(key: str, metrics: dict, percentiles: dict) -> dict:
    return {
        "key": key,
        "label": METRIC_LABELS[key],
        "value": metrics[key],
        "percentile": percentiles[key],
    }


def _build_phase_profiles(metrics: dict, percentiles: dict) -> dict:
    """Build honest phase reports: relative best areas and clearest improvements."""
    style_config = CFG["style"]
    item_limit = style_config["phase_items"]
    relative_strength_min = style_config["phase_relative_strength_percentile_min"]
    improvement_max = style_config["phase_improvement_percentile_max"]
    phases = {}
    for key, phase in PHASES.items():
        ranked = sorted(
            (
                _metric_item(metric_key, metrics, percentiles)
                for metric_key in phase["metrics"]
            ),
            key=lambda item: item["percentile"],
            reverse=True,
        )
        phases[key] = {
            "label": phase["label"],
            "score": round(
                sum(item["percentile"] for item in ranked) / len(ranked)
            ),
            "relative_strengths": [
                item for item in ranked if item["percentile"] >= relative_strength_min
            ][:item_limit],
            "improvements": [
                item for item in reversed(ranked) if item["percentile"] <= improvement_max
            ][:item_limit],
        }
    return phases


def _team_style_metrics(
    db: DB, season: str | None, league_id: int | None
) -> dict[tuple[int, int, str], dict]:
    clauses = ["m.home_score IS NOT NULL"]
    params: dict = {}
    if season:
        clauses.append("m.season = %(season)s")
        params["season"] = season
    if league_id:
        clauses.append("m.league_id = %(league_id)s")
        params["league_id"] = league_id

    rows = db.query(
        f"""
        WITH player_agg AS (
            SELECT
                match_id,
                team_id,
                SUM(passes_completed) AS passes_completed,
                SUM(passes_total) AS passes_total,
                SUM(big_chance_created) AS big_chances,
                SUM(key_passes) AS key_passes
            FROM match_player_stats
            GROUP BY match_id, team_id
        )
        SELECT
            s.team_id,
            m.league_id,
            m.season,
            COUNT(*) AS games,
            AVG(s.expected_goals) AS xg_for,
            AVG(o.expected_goals) AS xg_against,
            AVG(s.total_shots) AS shots_for,
            AVG(o.total_shots) AS shots_against,
            AVG(s.possession_pct) AS possession,
            AVG(sp.big_chances) AS big_chances_for,
            AVG(op.big_chances) AS big_chances_against,
            AVG(sp.key_passes) AS key_passes_for,
            AVG(sp.passes_completed) AS passes_for,
            SUM(sp.passes_completed)::numeric / NULLIF(SUM(sp.passes_total), 0)
                AS pass_accuracy,
            AVG(CASE WHEN m.home_team_id = s.team_id THEN m.home_score
                     ELSE m.away_score END) AS goals_for
            ,AVG(CASE WHEN m.home_team_id = s.team_id THEN m.away_score
                      ELSE m.home_score END) AS goals_against
        FROM match_team_stats s
        JOIN matches m ON m.id = s.match_id
        JOIN match_team_stats o ON o.match_id = s.match_id AND o.team_id <> s.team_id
        JOIN player_agg sp ON sp.match_id = s.match_id AND sp.team_id = s.team_id
        JOIN player_agg op ON op.match_id = s.match_id AND op.team_id = o.team_id
        WHERE {" AND ".join(clauses)}
        GROUP BY s.team_id, m.league_id, m.season
        """,
        params,
    )

    result: dict[tuple[int, int, str], dict] = {}
    for row in rows:
        goals_for = float(row["goals_for"] or 0)
        xg_for = float(row["xg_for"] or 0)
        result[(row["team_id"], row["league_id"], row["season"])] = {
            "games": int(row["games"]),
            "metrics": {
                "xg_for": round(xg_for, 2),
                "xg_against": round(float(row["xg_against"] or 0), 2),
                "shots_for": round(float(row["shots_for"] or 0), 1),
                "shots_against": round(float(row["shots_against"] or 0), 1),
                "big_chances_for": round(float(row["big_chances_for"] or 0), 2),
                "big_chances_against": round(
                    float(row["big_chances_against"] or 0), 2
                ),
                "key_passes_for": round(float(row["key_passes_for"] or 0), 1),
                "possession": round(float(row["possession"] or 0), 1),
                "passes_for": round(float(row["passes_for"] or 0), 0),
                "pass_accuracy": round(float(row["pass_accuracy"] or 0) * 100, 1),
                "goals_for": round(goals_for, 2),
                "finishing_overperformance": round(goals_for - xg_for, 2),
                "goals_against": round(float(row["goals_against"] or 0), 2),
            },
        }
    return result


def _build_style_profiles(
    db: DB, season: str | None, league_id: int | None
) -> list[dict]:
    raw = _team_style_metrics(db, season, league_id)
    groups: dict[tuple[int, str], list[tuple[int, dict]]] = defaultdict(list)
    for (team_id, league, profile_season), data in raw.items():
        groups[(league, profile_season)].append((team_id, data))

    profiles: list[dict] = []
    for (league, profile_season), teams in groups.items():
        distributions = {
            key: sorted_vals([team[1]["metrics"][key] for team in teams])
            for key, _, _ in STYLE_METRICS
        }
        for team_id, data in teams:
            metrics = data["metrics"]
            percentiles: dict[str, int] = {}
            for key, _label, higher_is_better in STYLE_METRICS:
                percentile = percentile_of(metrics[key], distributions[key])
                percentiles[key] = percentile if higher_is_better else 100 - percentile

            axes = {
                axis: round(sum(percentiles[key] for key in keys) / len(keys))
                for axis, keys in STYLE_AXES.items()
            }
            ranked = sorted(
                (
                    {
                        "key": key,
                        "label": label,
                        "value": metrics[key],
                        "percentile": percentiles[key],
                    }
                    for key, label, _ in STYLE_METRICS
                ),
                key=lambda item: item["percentile"],
                reverse=True,
            )
            style_config = CFG["style"]
            limit = style_config["max_items"]
            strengths = [
                item
                for item in ranked
                if item["percentile"] >= style_config["strength_percentile_min"]
            ][:limit]
            weaknesses = [
                item
                for item in reversed(ranked)
                if item["percentile"] <= style_config["weakness_percentile_max"]
            ][:limit]
            phases = _build_phase_profiles(metrics, percentiles)
            profiles.append(
                {
                    "team_id": team_id,
                    "league_id": league,
                    "season": profile_season,
                    "matches_played": data["games"],
                    "metrics": metrics,
                    "percentiles": percentiles,
                    "axes": axes,
                    "strengths": strengths,
                    "weaknesses": weaknesses,
                    "phases": phases,
                }
            )
    return profiles


def _store_style(db: DB, profiles: list[dict]) -> None:
    if not profiles:
        return
    psycopg2.extras.execute_values(
        db.conn.cursor(),
        """
        INSERT INTO team_style_profiles
            (team_id, league_id, season, matches_played,
             metrics, percentiles, axes, strengths, weaknesses, phases)
        VALUES %s
        ON CONFLICT (team_id, league_id, season) DO UPDATE SET
            matches_played = EXCLUDED.matches_played,
            metrics        = EXCLUDED.metrics,
            percentiles    = EXCLUDED.percentiles,
            axes           = EXCLUDED.axes,
            strengths      = EXCLUDED.strengths,
            weaknesses     = EXCLUDED.weaknesses,
            phases         = EXCLUDED.phases,
            updated_at     = now()
        """,
        [
            (
                profile["team_id"],
                profile["league_id"],
                profile["season"],
                profile["matches_played"],
                json.dumps(profile["metrics"]),
                json.dumps(profile["percentiles"]),
                json.dumps(profile["axes"]),
                json.dumps(profile["strengths"]),
                json.dumps(profile["weaknesses"]),
                json.dumps(profile["phases"]),
            )
            for profile in profiles
        ],
    )


def _clear_scope(db: DB, season: str | None, league_id: int | None) -> None:
    clauses, params = [], []
    if season:
        clauses.append("season = %s")
        params.append(season)
    if league_id:
        clauses.append("league_id = %s")
        params.append(league_id)
    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    db.execute(f"DELETE FROM team_style_profiles{where}", tuple(params))


def compute_teams(
    db: DB, season: str | None = None, league_id: int | None = None
) -> None:
    log.info(
        f"Building team style profiles (season={season or 'all'}, "
        f"league={league_id or 'all'})"
    )
    profiles = _build_style_profiles(db, season, league_id)
    _clear_scope(db, season, league_id)
    _store_style(db, profiles)
    log.info(f"Stored {len(profiles)} team style profiles")


def main() -> None:
    parser = argparse.ArgumentParser(description="Compute Know Ball team style analysis")
    parser.add_argument("--season", default=CURRENT_SEASON)
    parser.add_argument("--league", type=int, help="Limit to one DB league id")
    args = parser.parse_args()

    db = DB()
    db.execute("SET statement_timeout TO 0")
    compute_teams(db, season=args.season, league_id=args.league)
    db.close()
    log.info("Team style compute complete")


if __name__ == "__main__":
    main()
