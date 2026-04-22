-- Enable extensions for fuzzy/accent-insensitive search
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN trigram index on player names for fast similarity search
CREATE INDEX IF NOT EXISTS idx_players_name_trgm ON players USING GIN (name gin_trgm_ops);
    