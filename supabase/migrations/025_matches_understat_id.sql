ALTER TABLE matches ADD COLUMN IF NOT EXISTS understat_id INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS matches_understat_id_idx ON matches (understat_id) WHERE understat_id IS NOT NULL;
