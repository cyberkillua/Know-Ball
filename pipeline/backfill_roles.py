"""Populate role-fit columns from existing peer_ratings percentiles.

This is intentionally separate from the full compute job so role/archetype
tuning can be rerun without recalculating every rating dimension.
"""

from __future__ import annotations

import argparse

import psycopg2.extras

from pipeline.db import DB
from pipeline.engine.roles import assign_role_fit, role_metric_names
from pipeline.logger import get_logger

log = get_logger("backfill_roles")


def backfill_roles(
    db: DB,
    *,
    season: str | None = None,
    position: str | None = None,
    peer_mode: str = "dominant",
) -> int:
    filters = ["peer_mode = %s", "position_scope = ''"]
    params: list[object] = [peer_mode]
    if season:
        filters.append("season = %s")
        params.append(season)
    if position:
        filters.append("position = %s")
        params.append(position.upper())

    base_cols = ["id", "position", "cm_archetype", "rated_minutes"]
    metric_cols = role_metric_names()
    select_cols = ", ".join([*base_cols, *metric_cols])

    rows = db.query(
        f"""
        SELECT {select_cols}
        FROM peer_ratings
        WHERE {" AND ".join(filters)}
        ORDER BY position, season, player_id
        """,
        tuple(params),
    )

    updates = []
    for row in rows:
        role_fit = assign_role_fit(row, row["position"])
        primary = role_fit.get("primary") if role_fit else None
        role_archetype = primary.get("archetype") if primary else None
        role_family = primary.get("role") if primary else None
        role_confidence = role_fit.get("confidence", {}).get("score") if role_fit else None
        role_evidence = role_fit.get("evidence") if role_fit else None
        updates.append(
            (
                row["id"],
                role_archetype,
                role_archetype if row["position"] == "CM" else row.get("cm_archetype"),
                role_family,
                psycopg2.extras.Json(role_fit) if role_fit else None,
                role_confidence,
                psycopg2.extras.Json(role_evidence) if role_evidence else None,
            )
        )

    if not updates:
        return 0

    sql = """
        UPDATE peer_ratings AS pr
        SET role_archetype = v.role_archetype,
            cm_archetype = v.cm_archetype,
            role_family = v.role_family,
            role_fit = v.role_fit::jsonb,
            role_confidence = v.role_confidence,
            role_evidence = v.role_evidence::jsonb
        FROM (VALUES %s) AS v(
            id,
            role_archetype,
            cm_archetype,
            role_family,
            role_fit,
            role_confidence,
            role_evidence
        )
        WHERE pr.id = v.id
    """
    template = "(%s, %s, %s, %s, %s, %s, %s)"
    with db.conn.cursor() as cur:
        psycopg2.extras.execute_values(cur, sql, updates, template=template, page_size=1000)
    return len(updates)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--season", help="Only backfill one season")
    parser.add_argument("--position", help="Only backfill one peer position, e.g. ST, WINGER, CAM, CM, CB, FB")
    parser.add_argument("--peer-mode", default="dominant")
    args = parser.parse_args()

    db = DB()
    try:
        count = backfill_roles(
            db,
            season=args.season,
            position=args.position,
            peer_mode=args.peer_mode,
        )
        log.info(f"Backfilled role fits for {count} peer_rating rows")
    finally:
        db.close()


if __name__ == "__main__":
    main()
