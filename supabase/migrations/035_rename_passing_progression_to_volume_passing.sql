-- Rename passing_progression → volume_passing across match_ratings and peer_ratings.
-- The bucket was renamed because the calculation uses completed-pass volume + an
-- accuracy gate; it does not measure progression (no progressive-pass or
-- passes-into-final-third data at match level). The name overclaimed.

-- match_ratings: raw and normalized scores
ALTER TABLE match_ratings
  RENAME COLUMN passing_progression_raw  TO volume_passing_raw;

ALTER TABLE match_ratings
  RENAME COLUMN passing_progression_norm TO volume_passing_norm;

-- peer_ratings: percentile, stddev, p90
ALTER TABLE peer_ratings
  RENAME COLUMN passing_progression_percentile TO volume_passing_percentile;

ALTER TABLE peer_ratings
  RENAME COLUMN passing_progression_stddev TO volume_passing_stddev;

ALTER TABLE peer_ratings
  RENAME COLUMN passing_progression_p90    TO volume_passing_p90;
