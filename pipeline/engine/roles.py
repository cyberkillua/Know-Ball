"""Config-driven player role and archetype profiling."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any


CONFIG_PATH = (
    Path(__file__).resolve().parent.parent.parent / "config" / "role_profiles.json"
)


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _metric_value(player: dict[str, Any], metric: str) -> float | None:
    value = player.get(metric)
    if value is None:
        return None
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    if not numeric == numeric:
        return None
    return numeric


@lru_cache(maxsize=1)
def _role_config() -> dict[str, Any]:
    with open(CONFIG_PATH) as f:
        return json.load(f)


def role_definitions_for_position(position: str) -> list[dict[str, Any]]:
    config = _role_config()
    positions = config.get("positions", {})
    key = position.upper().strip()
    return (
        positions.get(key) or positions.get("DEF" if key in {"CB", "FB"} else key) or []
    )


def role_metric_names() -> list[str]:
    metrics = set()
    for roles in _role_config().get("positions", {}).values():
        for role in roles:
            for signal in role.get("signals", []):
                metric = signal.get("metric")
                if metric:
                    metrics.add(str(metric))
            for concern in role.get("concerns", []):
                metric = concern.get("metric")
                if metric:
                    metrics.add(str(metric))
            for gate in role.get("gates", []):
                metric = gate.get("metric")
                if metric:
                    metrics.add(str(metric))
    return sorted(metrics)


def _score_role(player: dict[str, Any], role: dict[str, Any]) -> dict[str, Any] | None:
    signals = role.get("signals", [])
    present: list[tuple[dict[str, Any], float]] = []
    for signal in signals:
        metric = str(signal.get("metric", ""))
        value = _metric_value(player, metric)
        if value is not None:
            present.append((signal, _clamp(value, 0.0, 100.0)))

    if not present:
        return None

    total_weight = sum(float(signal.get("weight", 1.0)) for signal, _ in present)
    if total_weight <= 0:
        return None

    score = (
        sum(value * float(signal.get("weight", 1.0)) for signal, value in present)
        / total_weight
    )

    gate_concerns = []
    gate_score_cap = None
    for gate in role.get("gates", []):
        metric = str(gate.get("metric", ""))
        value = _metric_value(player, metric)
        minimum = float(gate.get("min", 0))
        if value is None or value < minimum:
            gate_score_cap = min(
                float(gate.get("cap", 42)),
                gate_score_cap if gate_score_cap is not None else 100.0,
            )
            gate_concerns.append(
                {
                    "metric": metric,
                    "label": gate.get("label") or metric,
                    "value": round(float(value or 0), 1),
                    "threshold": round(minimum, 1),
                }
            )

    if gate_score_cap is not None:
        score = min(score, gate_score_cap)

    evidence = sorted(
        [
            {
                "metric": signal.get("metric"),
                "label": signal.get("label") or signal.get("metric"),
                "value": round(value, 1),
            }
            for signal, value in present
        ],
        key=lambda item: item["value"],
        reverse=True,
    )[:3]

    concerns = gate_concerns[:]
    for concern in role.get("concerns", []):
        metric = str(concern.get("metric", ""))
        value = _metric_value(player, metric)
        threshold = float(concern.get("below", 0))
        if value is not None and value < threshold:
            concerns.append(
                {
                    "metric": metric,
                    "label": concern.get("label") or metric,
                    "value": round(value, 1),
                    "threshold": round(threshold, 1),
                }
            )

    if not concerns:
        low_signals = [
            {
                "metric": signal.get("metric"),
                "label": signal.get("label") or signal.get("metric"),
                "value": round(value, 1),
                "threshold": 40,
            }
            for signal, value in present
            if value < 40
        ]
        concerns = sorted(low_signals, key=lambda item: item["value"])[:2]

    return {
        "key": role.get("key"),
        "label": role.get("label"),
        "role": role.get("role"),
        "role_label": role.get("role_label"),
        "archetype": role.get("archetype") or role.get("key"),
        "archetype_label": role.get("archetype_label") or role.get("label"),
        "score": round(score, 1),
        "evidence": evidence,
        "concerns": concerns[:2],
    }


def role_confidence(
    *,
    top_score: float,
    second_score: float | None,
    rated_minutes: int | float | None,
) -> dict[str, Any]:
    gap = top_score - (second_score if second_score is not None else 0.0)
    minutes = float(rated_minutes or 0)
    minutes_score = _clamp(minutes / 900.0 * 100.0, 0.0, 100.0)
    margin_score = _clamp(gap * 5.0, 0.0, 100.0)
    confidence = round(0.45 * minutes_score + 0.4 * margin_score + 0.15 * top_score, 1)
    if top_score < 50:
        confidence = min(confidence, 44.0)
    elif top_score < 62:
        confidence = min(confidence, 69.0)
    level = "low" if confidence < 45 else "moderate" if confidence < 70 else "high"
    return {
        "score": confidence,
        "level": level,
        "gap": round(gap, 1),
        "hybrid": second_score is not None and gap < 6,
    }


def assign_role_fit(player: dict[str, Any], position: str) -> dict[str, Any] | None:
    """Return a role-fit profile with top roles, confidence, evidence, and concerns."""
    roles = role_definitions_for_position(position)
    fits = [_score_role(player, role) for role in roles]
    top = sorted(
        [fit for fit in fits if fit is not None],
        key=lambda fit: float(fit["score"]),
        reverse=True,
    )[:3]

    if not top:
        return None

    confidence = role_confidence(
        top_score=float(top[0]["score"]),
        second_score=float(top[1]["score"]) if len(top) > 1 else None,
        rated_minutes=player.get("rated_minutes"),
    )

    return {
        "version": _role_config().get("version", 1),
        "primary": top[0],
        "top": top,
        "confidence": confidence,
        "evidence": top[0].get("evidence", []),
        "concerns": top[0].get("concerns", []),
    }
