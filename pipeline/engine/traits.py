"""Config-driven player style trait profiling."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any


CONFIG_PATH = (
    Path(__file__).resolve().parent.parent.parent / "config" / "model_traits.json"
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
def _trait_config() -> dict[str, Any]:
    with open(CONFIG_PATH) as f:
        return json.load(f)


def trait_definitions_for_position(position: str) -> list[dict[str, Any]]:
    config = _trait_config()
    positions = config.get("positions", {})
    key = position.upper().strip()
    fallback = "W" if key == "WINGER" else "DEF" if key in {"CB", "FB"} else key
    return positions.get(key) or positions.get(fallback) or []


def trait_metric_names() -> list[str]:
    metrics = set()
    for traits in _trait_config().get("positions", {}).values():
        for trait in traits:
            for signal in trait.get("signals", []):
                metric = signal.get("metric")
                if metric:
                    metrics.add(str(metric))
            for concern in trait.get("concerns", []):
                metric = concern.get("metric")
                if metric:
                    metrics.add(str(metric))
            for gate in trait.get("gates", []):
                metric = gate.get("metric")
                if metric:
                    metrics.add(str(metric))
    return sorted(metrics)


def trait_metric_names_for_position(position: str) -> list[str]:
    metrics = set()
    for trait in trait_definitions_for_position(position):
        for signal in trait.get("signals", []):
            metric = signal.get("metric")
            if metric:
                metrics.add(str(metric))
        for concern in trait.get("concerns", []):
            metric = concern.get("metric")
            if metric:
                metrics.add(str(metric))
        for gate in trait.get("gates", []):
            metric = gate.get("metric")
            if metric:
                metrics.add(str(metric))
    return sorted(metrics)


def _signal_value(player: dict[str, Any], signal: dict[str, Any]) -> float | None:
    raw_value = _metric_value(player, str(signal.get("metric", "")))
    if raw_value is None:
        return None
    value = _clamp(raw_value, 0.0, 100.0)
    if signal.get("invert"):
        return 100.0 - value
    return value


def _score_trait(player: dict[str, Any], trait: dict[str, Any]) -> dict[str, Any] | None:
    signals = trait.get("signals", [])
    present: list[tuple[dict[str, Any], float]] = []
    for signal in signals:
        value = _signal_value(player, signal)
        if value is not None:
            present.append((signal, value))

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
    for gate in trait.get("gates", []):
        metric = str(gate.get("metric", ""))
        raw_value = _metric_value(player, metric)
        if raw_value is None:
            continue
        value = _clamp(raw_value, 0.0, 100.0)
        minimum = gate.get("min")
        maximum = gate.get("max")
        gate_failed = False
        threshold = None
        if minimum is not None and value < float(minimum):
            gate_failed = True
            threshold = float(minimum)
        if maximum is not None and value > float(maximum):
            gate_failed = True
            threshold = float(maximum)
        if gate_failed:
            gate_score_cap = min(
                float(gate.get("cap", 55)),
                gate_score_cap if gate_score_cap is not None else 100.0,
            )
            gate_concerns.append(
                {
                    "metric": metric,
                    "label": gate.get("label") or metric,
                    "value": round(value, 1),
                    "threshold": round(float(threshold or 0), 1),
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
    for concern in trait.get("concerns", []):
        metric = str(concern.get("metric", ""))
        value = _metric_value(player, metric)
        threshold = float(concern.get("below", 0))
        if value is not None and value < threshold:
            concerns.append(
                {
                    "metric": metric,
                    "label": concern.get("label") or metric,
                    "value": round(float(value), 1),
                    "threshold": round(threshold, 1),
                }
            )

    return {
        "key": trait.get("key"),
        "label": trait.get("label"),
        "description": trait.get("description"),
        "family": trait.get("family"),
        "risk": bool(trait.get("risk")),
        "score": round(score, 1),
        "evidence": evidence,
        "concerns": concerns[:3],
    }


def style_confidence(
    *,
    top_score: float,
    rated_minutes: int | float | None,
    coverage: float,
    minimum_minutes: int | float = 600,
) -> dict[str, Any]:
    minutes = float(rated_minutes or 0)
    minutes_score = _clamp(minutes / float(minimum_minutes or 600) * 100.0, 0.0, 100.0)
    confidence = round(0.45 * minutes_score + 0.35 * coverage + 0.2 * top_score, 1)
    if minutes < float(minimum_minutes or 600):
        confidence = min(confidence, 59.0)
    level = "low" if confidence < 45 else "moderate" if confidence < 70 else "high"
    reasons = []
    if minutes < float(minimum_minutes or 600):
        reasons.append("Limited rated minutes")
    if coverage < 70:
        reasons.append("Some trait inputs are missing")
    if top_score >= 70:
        reasons.append("Strong agreement across top trait signals")
    return {"score": confidence, "level": level, "reasons": reasons}


def assign_style_profile(player: dict[str, Any], position: str) -> dict[str, Any] | None:
    """Return a style fingerprint with strengths, risks, confidence, and evidence."""
    traits = trait_definitions_for_position(position)
    scored = [_score_trait(player, trait) for trait in traits]
    top = sorted(
        [trait for trait in scored if trait is not None],
        key=lambda trait: float(trait["score"]),
        reverse=True,
    )

    if not top:
        return None

    strength_traits = [trait for trait in top if not trait.get("risk")]
    risk_traits = [trait for trait in top if trait.get("risk") and trait["score"] >= 50]
    primary = strength_traits[0] if strength_traits else top[0]
    position_metrics = trait_metric_names_for_position(position)
    metric_count = len(position_metrics)
    present_count = sum(
        1 for metric in position_metrics if _metric_value(player, metric) is not None
    )
    coverage = round((present_count / metric_count * 100.0) if metric_count else 0.0, 1)
    minimum_minutes = min(
        [float(trait.get("minimum_minutes", 600)) for trait in traits] or [600.0]
    )
    confidence = style_confidence(
        top_score=float(primary["score"]),
        rated_minutes=player.get("rated_minutes"),
        coverage=coverage,
        minimum_minutes=minimum_minutes,
    )

    concerns = []
    for trait in strength_traits[:3]:
        concerns.extend(trait.get("concerns", []))

    return {
        "version": _trait_config().get("version", 1),
        "position": position,
        "primary": primary,
        "strengths": strength_traits[:5],
        "risks": risk_traits[:3],
        "top": top[:6],
        "confidence": confidence,
        "coverage": coverage,
        "evidence": primary.get("evidence", []),
        "concerns": concerns[:4],
    }
