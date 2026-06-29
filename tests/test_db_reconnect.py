from unittest.mock import MagicMock, patch

import psycopg2

from pipeline.core.db import DB


def test_query_reconnects_once_after_operational_error():
    dropped_connection = MagicMock()
    dropped_connection.cursor.side_effect = psycopg2.OperationalError("connection dropped")

    healthy_cursor = MagicMock()
    healthy_cursor.__enter__.return_value = healthy_cursor
    healthy_cursor.fetchall.return_value = [{"count": 42}]
    healthy_connection = MagicMock()
    healthy_connection.cursor.return_value = healthy_cursor

    with patch(
        "pipeline.core.db.get_connection",
        side_effect=[dropped_connection, healthy_connection],
    ):
        db = DB()
        rows = db.query("SELECT 42 AS count")

    assert rows == [{"count": 42}]
    dropped_connection.close.assert_called_once()


def test_query_only_reconnects_once():
    first_connection = MagicMock()
    first_connection.cursor.side_effect = psycopg2.OperationalError("first drop")
    second_connection = MagicMock()
    second_connection.cursor.side_effect = psycopg2.OperationalError("second drop")

    with patch(
        "pipeline.core.db.get_connection",
        side_effect=[first_connection, second_connection],
    ):
        db = DB()
        try:
            db.query("SELECT 1")
        except psycopg2.OperationalError as exc:
            assert str(exc) == "second drop"
        else:
            raise AssertionError("expected the second connection failure to be raised")
