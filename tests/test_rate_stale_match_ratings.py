from pipeline.model.rate import delete_stale_match_ratings


class FakeDB:
    def __init__(self):
        self.calls = []

    def execute(self, sql, params=()):
        self.calls.append((sql, params))


def test_delete_stale_match_ratings_normalizes_profile_positions():
    db = FakeDB()

    delete_stale_match_ratings(db)

    sql, params = db.calls[0]
    assert "DELETE FROM match_ratings mr" in sql
    assert "mr.position IS DISTINCT FROM" in sql
    assert "'CF'" in sql
    assert "THEN 'ST'" in sql
    assert "'CAM'" in sql
    assert "THEN 'CAM'" in sql
    assert params == ()


def test_delete_stale_match_ratings_respects_requested_scope():
    db = FakeDB()

    delete_stale_match_ratings(db, season="2025/2026", league_id=47)

    sql, params = db.calls[0]
    assert "m.season = %s" in sql
    assert "m.league_id = %s" in sql
    assert params == ("2025/2026", 47)
