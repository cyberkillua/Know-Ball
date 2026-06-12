-- Add phase-based team reporting for attack, midfield/control, and defence.
ALTER TABLE team_style_profiles
  ADD COLUMN IF NOT EXISTS phases JSONB NOT NULL DEFAULT '{}'::jsonb;
