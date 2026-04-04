"""Database client for the Know Ball pipeline using direct Postgres connection."""

import os
import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

load_dotenv()


def get_connection():
    """Get a psycopg2 connection to the Supabase Postgres database."""
    return psycopg2.connect(os.environ["DATABASE_URL"])


class DB:
    """Simple wrapper around psycopg2 for common operations."""

    def __init__(self):
        self.conn = get_connection()
        self.conn.autocommit = True

    def query(self, sql: str, params: tuple = ()) -> list[dict]:
        """Execute a SELECT and return rows as dicts."""
        with self.conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, params)
            return [dict(row) for row in cur.fetchall()]

    def query_one(self, sql: str, params: tuple = ()) -> dict | None:
        """Execute a SELECT and return a single row or None."""
        rows = self.query(sql, params)
        return rows[0] if rows else None

    def execute(self, sql: str, params: tuple = ()) -> None:
        """Execute a non-returning statement."""
        if params and isinstance(params, dict):
            with self.conn.cursor() as cur:
                cur.execute(sql, params)
        elif params and isinstance(params[0], (list, tuple)) and len(params) == 1:
            psycopg2.extras.execute_values(self.conn.cursor(), sql, params[0])
        else:
            with self.conn.cursor() as cur:
                cur.execute(sql, params)

    def insert_returning(self, sql: str, params: tuple = ()) -> dict:
        """Execute an INSERT ... RETURNING and return the row."""
        with self.conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, params)
            return dict(cur.fetchone())

    def close(self):
        self.conn.close()
