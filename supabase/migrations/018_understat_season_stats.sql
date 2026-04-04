-- Understat season-level stats for midfielders (CAM, CM, CDM, LM, RM, AM)
-- Stores xGChain and xGBuildup fetched from understat.com league player pages.

CREATE TABLE IF NOT EXISTS player_season_understat (
  player_id        INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  season           TEXT    NOT NULL,
  xg_chain         NUMERIC,
  xg_buildup       NUMERIC,
  xg_chain_per90   NUMERIC,
  xg_buildup_per90 NUMERIC,
  minutes_played   INTEGER,
  fetched_at       TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (player_id, season)
);

CREATE INDEX IF NOT EXISTS idx_player_season_understat_player
  ON player_season_understat (player_id);
