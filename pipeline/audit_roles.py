"""Audit role/archetype assignments produced by compute.py.

Usage:
    python -m pipeline.audit_roles --season 2025/2026
    python -m pipeline.audit_roles --position WINGER --limit 8
"""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from pipeline.db import DB


def fetch_rows(db: DB, season: str | None, position: str | None) -> list[dict]:
    filters = [
        "pr.peer_mode = 'dominant'",
        "pr.position_scope = ''",
        "pr.role_fit IS NOT NULL",
    ]
    params: list[Any] = []
    if season:
        params.append(season)
        filters.append(f"pr.season = %s")
    if position:
        params.append(position.upper())
        filters.append("pr.position = %s")

    return db.query(
        f"""
        SELECT pr.position, pr.season, pr.role_archetype, pr.role_family,
               pr.role_confidence, pr.model_score, pr.rated_minutes,
               pr.role_fit #>> '{{primary,label}}' as primary_label,
               COALESCE((pr.role_fit #>> '{{primary,score}}')::numeric, 0) as primary_score,
               pr.role_fit #>> '{{confidence,level}}' as confidence_level,
               COALESCE((pr.role_fit #>> '{{confidence,score}}')::numeric, 0) as confidence_score,
               COALESCE((pr.role_fit #>> '{{confidence,gap}}')::numeric, 0) as confidence_gap,
               COALESCE((pr.role_fit #>> '{{confidence,hybrid}}')::boolean, false) as is_hybrid,
               p.name as player_name, l.name as league_name
        FROM peer_ratings pr
        JOIN players p ON p.id = pr.player_id
        LEFT JOIN leagues l ON l.id = pr.league_id
        WHERE {" AND ".join(filters)}
        ORDER BY pr.position, pr.role_archetype, pr.role_confidence DESC NULLS LAST
        """,
        tuple(params),
    )


def print_audit(rows: list[dict[str, Any]], limit: int) -> None:
    print(f"Role audit rows: {len(rows)}")
    if not rows:
        return

    by_position = defaultdict(list)
    for row in rows:
        by_position[row["position"]].append(row)

    for position, position_rows in sorted(by_position.items()):
        print(f"\n## {position}")
        role_counts = Counter(row.get("role_archetype") or "unassigned" for row in position_rows)
        confidence_counts = Counter(row.get("confidence_level") or "unknown" for row in position_rows)
        print("Role distribution:")
        for role, count in role_counts.most_common():
            print(f"- {role}: {count}")
        print("Confidence distribution:")
        for level, count in confidence_counts.most_common():
            print(f"- {level}: {count}")

        print("Top examples:")
        examples_by_role = defaultdict(list)
        for row in position_rows:
            examples_by_role[row.get("role_archetype") or "unassigned"].append(row)
        for role, role_rows in sorted(examples_by_role.items()):
            print(f"- {role}")
            for row in sorted(role_rows, key=lambda r: float(r.get("role_confidence") or 0), reverse=True)[:limit]:
                print(
                    f"  - {row['player_name']} ({row.get('league_name') or 'League'}, {row['season']}): "
                    f"fit {float(row.get('primary_score') or 0):.1f}, confidence {row.get('confidence_score') or 0}"
                )

        low_confidence = [
            row for row in position_rows
            if row.get("confidence_level") == "low"
        ][:limit]
        if low_confidence:
            print("Low-confidence assignments to inspect:")
            for row in low_confidence:
                print(
                    f"- {row['player_name']} - {row.get('primary_label') or 'Role'} "
                    f"({row.get('league_name') or 'League'}, {row['season']})"
                )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--season", help="Filter to one season, e.g. 2025/2026")
    parser.add_argument("--position", help="Filter to one peer position, e.g. ST, WINGER, CAM, CM, CB, FB")
    parser.add_argument("--limit", type=int, default=5)
    args = parser.parse_args()

    db = DB()
    try:
        rows = fetch_rows(db, args.season, args.position)
        print_audit(rows, args.limit)
    finally:
        db.close()


if __name__ == "__main__":
    main()
