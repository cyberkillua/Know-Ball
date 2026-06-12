-- League-relative team style analysis populated by pipeline/model/compute_teams.py.
CREATE TABLE IF NOT EXISTS team_style_profiles (
  id              SERIAL PRIMARY KEY,
  team_id         INTEGER NOT NULL REFERENCES teams(id),
  league_id       INTEGER NOT NULL REFERENCES leagues(id),
  season          TEXT    NOT NULL,
  matches_played  INTEGER NOT NULL,
  metrics         JSONB   NOT NULL,
  percentiles     JSONB   NOT NULL,
  axes            JSONB   NOT NULL,
  strengths       JSONB   NOT NULL,
  weaknesses      JSONB   NOT NULL,
  phases          JSONB   NOT NULL,
  tendencies      JSONB   NOT NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (team_id, league_id, season)
);

CREATE INDEX IF NOT EXISTS idx_team_style_profiles_lookup
  ON team_style_profiles (team_id, season);
